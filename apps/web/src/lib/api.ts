/**
 * Minimal typed client for the Aegis API. The dashboard never talks to PostgreSQL directly (Decisions D-003).
 * NEXT_PUBLIC_API_URL is the only coupling; it is inlined at build time for client components and read at
 * request time in server components.
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export interface HealthResponse {
  status: "ok" | "degraded";
  db: "ok" | "unavailable";
  db_latency_ms: number;
  error?: string;
  version: string;
  uptime_s: number;
  timestamp: string;
}

export type HealthResult = { reachable: true; health: HealthResponse } | { reachable: false; error: string };

export async function getHealth(timeoutMs = 2000): Promise<HealthResult> {
  try {
    const res = await fetch(`${API_URL}/health`, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { reachable: false, error: `HTTP ${res.status}` };
    return { reachable: true, health: (await res.json()) as HealthResponse };
  } catch (error) {
    return { reachable: false, error: error instanceof Error ? error.message : String(error) };
  }
}
