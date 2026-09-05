/**
 * Stable prefixes used by the simulator. They intentionally mirror Razorpay's
 * natural-key shape while keeping generated rows separate from seeded fixtures.
 */
export const SIM_ID_PREFIXES = {
  payment: 'pay_',
  order: 'order_',
  subscription: 'sub_',
  invoice: 'inv_',
  dispute: 'disp_',
  event: 'evt_',
  customer: 'cus_',
} as const;

export type SimIdKind = keyof typeof SIM_ID_PREFIXES;
export type SimSeed = number | string;

export interface SimIdFactory {
  /** Generate an id for one of the simulator's known entity kinds. */
  next(kind: SimIdKind): string;
  pay(): string;
  payment(): string;
  order(): string;
  sub(): string;
  subscription(): string;
  inv(): string;
  invoice(): string;
  disp(): string;
  dispute(): string;
  evt(): string;
  event(): string;
  customer(): string;
  paymentId(): string;
  orderId(): string;
  subscriptionId(): string;
  invoiceId(): string;
  disputeId(): string;
  eventId(): string;
  customerId(): string;
}

// Intent: a fixed fallback keeps direct builder calls deterministic; the CLI can pass a fresh seed when it wants a new run.
// Flow: normalize the supplied number/string -> initialize the small local PRNG -> expose only monotonic id methods.
export const DEFAULT_SIM_SEED: SimSeed = 'aegis-simulator-v1';

// Intent: map both numeric and textual CLI seeds to the same 32-bit state without a dependency or clock input.
// Flow: preserve finite integers -> hash string code points with FNV-1a -> normalize the result to unsigned bits.
function hashSeed(seed: SimSeed): number {
  if (typeof seed === 'number' && Number.isFinite(seed)) return (Math.trunc(seed) >>> 0);
  if (typeof seed === 'string' && /^\d+$/.test(seed)) {
    const numeric = Number(seed);
    if (Number.isSafeInteger(numeric)) return numeric >>> 0;
  }

  const value = String(seed);
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

// Intent: keep random-looking suffixes while making every generated id replayable from the normalized seed.
// Flow: advance the 32-bit state -> mix its bits -> convert the unsigned result to a unit interval value.
function createMulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 1_835_769_333) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function randomToken(random: () => number): string {
  return Math.floor(random() * 4_294_967_296).toString(16).padStart(8, '0');
}

/**
 * Create a deterministic id source for one simulator run.
 * Intent: every generated id must be reproducible from `seed`, yet distinct within a run even when entities share a type.
 * Flow: seed the PRNG once -> increment a per-kind sequence -> combine sequence and token under the Razorpay prefix.
 */
export function createIdFactory(seed: SimSeed = DEFAULT_SIM_SEED): SimIdFactory {
  const random = createMulberry32(hashSeed(seed));
  const counters: Record<SimIdKind, number> = {
    payment: 0,
    order: 0,
    subscription: 0,
    invoice: 0,
    dispute: 0,
    event: 0,
    customer: 0,
  };

  const next = (kind: SimIdKind): string => {
    counters[kind] += 1;
    const sequence = counters[kind].toString(36).padStart(4, '0');
    return `${SIM_ID_PREFIXES[kind]}${sequence}_${randomToken(random)}`;
  };

  return {
    next,
    pay: () => next('payment'),
    payment: () => next('payment'),
    order: () => next('order'),
    sub: () => next('subscription'),
    subscription: () => next('subscription'),
    inv: () => next('invoice'),
    invoice: () => next('invoice'),
    disp: () => next('dispute'),
    dispute: () => next('dispute'),
    evt: () => next('event'),
    event: () => next('event'),
    customer: () => next('customer'),
    paymentId: () => next('payment'),
    orderId: () => next('order'),
    subscriptionId: () => next('subscription'),
    invoiceId: () => next('invoice'),
    disputeId: () => next('dispute'),
    eventId: () => next('event'),
    customerId: () => next('customer'),
  };
}

/** Alias for callers that describe the source as a run rather than a factory. */
export const createSimIdFactory = createIdFactory;
