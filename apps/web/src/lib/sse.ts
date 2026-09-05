"use client";

/**
 * Live updates from `GET /api/v1/stream` (Flow.md F10).
 * Intent: one EventSource per browser tab, shared by every hook, with reconnect/backoff the browser does not give us
 *         (EventSource retries at a fixed interval and never reports "reconnecting"). The bus is a notification channel,
 *         not storage (C-C6): the buffer keeps the last 200 envelopes for rendering and nothing else.
 * Flow: first subscriber connects -> one listener per bus event name -> envelopes are pushed newest-first into a
 *       bounded buffer -> hooks read snapshots through useSyncExternalStore -> last unsubscriber closes the socket.
 */
import { BUS_EVENT_NAMES, type BusEventName } from "@aegis/shared";
import { useEffect, useEffectEvent, useMemo, useSyncExternalStore } from "react";
import { API_URL } from "./api";

export interface StreamEvent<T = unknown> {
  readonly seq: number;
  readonly name: BusEventName;
  readonly data: T;
  readonly receivedAt: number;
}

export type StreamStatus = "connecting" | "live" | "reconnecting";

export interface StreamSnapshot {
  readonly events: readonly StreamEvent[];
  readonly status: StreamStatus;
  readonly attempts: number;
}

export const MAX_BUFFERED_EVENTS = 200;
export const BACKOFF_MIN_MS = 1_000;
export const BACKOFF_MAX_MS = 10_000;

/** Pure: exponential backoff 1 s → 10 s (attempt 1 → 1000, 2 → 2000, 3 → 4000, 4 → 8000, 5+ → 10000). */
export function backoffDelayMs(attempt: number): number {
  const bounded = Math.max(1, Math.floor(Number.isFinite(attempt) ? attempt : 1));
  return Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** (bounded - 1));
}

/** Pure: prepend keeping the newest `max` items. */
export function pushBounded<T>(list: readonly T[], item: T, max: number = MAX_BUFFERED_EVENTS): T[] {
  return [item, ...list].slice(0, max);
}

/** Pure: parse one SSE `data:` payload. Malformed JSON is kept as `{ raw, parseError }` instead of being dropped. */
export function parseEventData(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    return { raw, parseError: error instanceof Error ? error.message : String(error) };
  }
}

/** Pure: keep only the named events (newest first). An empty/undefined filter returns everything. */
export function filterEvents(events: readonly StreamEvent[], names?: readonly string[]): StreamEvent[] {
  if (!names || names.length === 0) return [...events];
  const wanted = new Set(names);
  return events.filter((event) => wanted.has(event.name));
}

type Listener = () => void;
type EventListener = (event: StreamEvent) => void;

const EMPTY_SNAPSHOT: StreamSnapshot = Object.freeze({ events: Object.freeze([]) as readonly StreamEvent[], status: "connecting", attempts: 0 });

class StreamStore {
  private snapshot: StreamSnapshot = EMPTY_SNAPSHOT;
  private readonly listeners = new Set<Listener>();
  private readonly eventListeners = new Set<EventListener>();
  private source: EventSource | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;

  constructor(private readonly url: string) {}

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    if (this.source === null && this.timer === null) this.connect();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.eventListeners.size === 0) this.disconnect();
    };
  };

  readonly onEvent = (listener: EventListener): (() => void) => {
    this.eventListeners.add(listener);
    if (this.source === null && this.timer === null) this.connect();
    return () => {
      this.eventListeners.delete(listener);
      if (this.listeners.size === 0 && this.eventListeners.size === 0) this.disconnect();
    };
  };

  readonly getSnapshot = (): StreamSnapshot => this.snapshot;

  private connect(): void {
    if (typeof EventSource === "undefined") return;
    const source = new EventSource(this.url);
    this.source = source;
    for (const name of BUS_EVENT_NAMES) {
      source.addEventListener(name, (message: MessageEvent<string>) => {
        const event: StreamEvent = { seq: ++this.seq, name, data: parseEventData(message.data), receivedAt: Date.now() };
        this.update({ ...this.snapshot, events: pushBounded(this.snapshot.events, event) });
        for (const listener of [...this.eventListeners]) listener(event);
      });
    }
    source.onopen = () => this.update({ ...this.snapshot, status: "live", attempts: 0 });
    source.onerror = () => {
      // Intent: own the retry schedule (1 s → 10 s) so a dead API does not hammer the network and the UI can say
      // "reconnecting" honestly instead of pretending to be live.
      source.close();
      if (this.source !== source) return;
      this.source = null;
      const attempts = this.snapshot.attempts + 1;
      this.update({ ...this.snapshot, status: "reconnecting", attempts });
      this.timer = setTimeout(() => {
        this.timer = null;
        if (this.listeners.size > 0 || this.eventListeners.size > 0) this.connect();
      }, backoffDelayMs(attempts));
    };
  }

  private disconnect(): void {
    this.source?.close();
    this.source = null;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.update({ ...this.snapshot, status: "connecting", attempts: 0 });
  }

  private update(next: StreamSnapshot): void {
    this.snapshot = next;
    for (const listener of [...this.listeners]) listener();
  }
}

let store: StreamStore | null = null;

function getStore(): StreamStore {
  if (store === null) store = new StreamStore(`${API_URL}/api/v1/stream`);
  return store;
}

const getServerSnapshot = (): StreamSnapshot => EMPTY_SNAPSHOT;

/**
 * Subscribe to live bus events. Returns the buffered events for `names` (all events when omitted), newest first,
 * and the connection status. Every caller shares one EventSource.
 */
export function useEventStream(names?: readonly BusEventName[]): { events: StreamEvent[]; status: StreamStatus; latest: StreamEvent | undefined } {
  const s = getStore();
  const snapshot = useSyncExternalStore(s.subscribe, s.getSnapshot, getServerSnapshot);
  const key = names ? names.join("|") : "";
  const events = useMemo(() => filterEvents(snapshot.events, key === "" ? undefined : key.split("|")), [snapshot.events, key]);
  return { events, status: snapshot.status, latest: events[0] };
}

/** Run `handler` for each new event with one of `names`, without re-rendering the caller. */
export function useStreamEffect(names: readonly BusEventName[], handler: (event: StreamEvent) => void): void {
  const onEvent = useEffectEvent(handler);
  const key = names.join("|");
  useEffect(() => {
    const wanted = new Set(key.split("|"));
    return getStore().onEvent((event) => {
      if (wanted.has(event.name)) onEvent(event);
    });
  }, [key]);
}

/** Connection status only (top bar indicator). */
export function useStreamStatus(): StreamStatus {
  const s = getStore();
  return useSyncExternalStore(s.subscribe, s.getSnapshot, getServerSnapshot).status;
}
