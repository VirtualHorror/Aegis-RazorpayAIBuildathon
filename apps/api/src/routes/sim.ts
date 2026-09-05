import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  SIM_SCENARIO_NAMES,
  buildAllScenarios,
  buildScenario,
  createIdFactory,
  type SimScenario,
  type SimScenarioName,
} from '@aegis/shared';
import type { Config } from '../config';
import { computeSignature } from '../ingress/signature';
import type pg from 'pg';

const SimRequestSchema = z.object({
  scenario: z.string().min(1).default('all'),
  dupes: z.number().int().nonnegative().max(1_000).optional().default(0),
  burst: z.number().int().positive().max(10_000).optional(),
  seed: z.union([
    z.number().int().nonnegative().max(0xffff_ffff),
    z.string().min(1),
  ]).optional(),
  chaos: z.literal('llm_down').optional(),
});

export interface SimRouteOptions {
  config: Pick<Config, 'RAZORPAY_WEBHOOK_SECRET'>;
  db: pg.Pool | null;
}

interface SimDeliveryResult {
  scenario: string;
  status_code: number;
  status: string;
  event_id: string;
  latency_ms: number;
}

interface SimTotals {
  accepted: number;
  duplicate: number;
  rejected: number;
  ignored: number;
  rate_limited: number;
}

/**
 * Development-only route used by the dashboard's Run demo control.
 * Intent: exercise the same signed webhook ingress as the CLI while keeping simulation unavailable in production.
 * Flow: parse request -> build deterministic shared fixtures -> inject raw signed deliveries into the real ingress -> summarize.
 */
export const simRoutes: FastifyPluginAsync<SimRouteOptions> = async (app, options) => {
  app.post('/sim/run', async (request, reply) => {
    const parsed = SimRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      await reply.code(400).send({ error: 'invalid_simulation_request', details: parsed.error.issues });
      return;
    }

    const input = parsed.data;
    const seed = input.seed ?? randomBytes(4).readUInt32BE(0);
    const ids = createIdFactory(seed);
    let scenarios: readonly SimScenario[];
    try {
      scenarios = buildRequestedScenarios(input.scenario, input.burst, ids);
    } catch (error) {
      await reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
      return;
    }

    const deliveries = await postScenarios(app, scenarios, input.dupes, options.config.RAZORPAY_WEBHOOK_SECRET, input.chaos, options.db, input.burst !== undefined);

    const totals = summarizeTotals(deliveries);
    return {
      seed,
      scenario: input.scenario,
      results: deliveries,
      totals,
      p50_latency_ms: percentile(deliveries.map((delivery) => delivery.latency_ms), 0.5),
      p95_latency_ms: percentile(deliveries.map((delivery) => delivery.latency_ms), 0.95),
    };
  });
};

function buildRequestedScenarios(scenario: string, burst: number | undefined, ids: ReturnType<typeof createIdFactory>): readonly SimScenario[] {
  if (scenario === 'all') {
    if (burst !== undefined) throw new Error('--burst cannot be combined with the all scenario');
    return buildAllScenarios({ ids });
  }

  const requested = scenario === 'burst' ? 'payment_failed_3ds_intl' : scenario;
  if (!isScenarioName(requested)) throw new Error(`unknown simulation scenario: ${scenario}`);
  const count = burst ?? 1;
  return Array.from({ length: count }, () => buildScenario(requested, { ids }));
}

function isScenarioName(value: string): value is SimScenarioName {
  return (SIM_SCENARIO_NAMES as readonly string[]).includes(value);
}

async function postDelivery(
  app: FastifyInstance,
  scenario: SimScenario,
  secret: string,
  chaos: 'llm_down' | undefined,
  db: pg.Pool | null,
): Promise<SimDeliveryResult> {
  const raw = Buffer.from(JSON.stringify(scenario.webhook));
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-razorpay-signature': scenario.signatureValid ? computeSignature(raw, secret) : '0'.repeat(64),
    'x-razorpay-event-id': scenario.eventId,
  };
  if (chaos) headers['x-aegis-chaos'] = chaos;

  const started = performance.now();
  const response = await app.inject({ method: 'POST', url: '/webhooks/razorpay', headers, payload: raw });
  const latencyMs = Math.max(0, Math.round(performance.now() - started));
  const body = parseResponse(response.body);
  const responseStatus = typeof body.status === 'string'
    ? body.status
    : response.statusCode === 401 ? 'rejected' : response.statusCode === 429 ? 'rate_limited' : 'error';
  let status = response.statusCode === 429 ? 'rate_limited' : response.statusCode === 401 ? 'rejected' : responseStatus;
  if (scenario.webhook.event === 'settlement.processed' && response.statusCode === 200 && responseStatus === 'accepted') {
    const durableStatus = await durableEventStatus(db, scenario.eventId);
    if (durableStatus !== 'ignored') {
      throw new Error(`unknown_event ${scenario.eventId} was not durably classified as ignored with zero jobs`);
    }
    status = 'ignored';
  }
  return {
    scenario: scenario.name,
    status_code: response.statusCode,
    status,
    event_id: scenario.eventId,
    latency_ms: latencyMs,
  };
}

function parseResponse(body: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(body);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch (error) {
    throw new Error(`sim ingress returned a non-JSON response: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

async function postScenarios(
  app: FastifyInstance,
  scenarios: readonly SimScenario[],
  dupes: number,
  secret: string,
  chaos: 'llm_down' | undefined,
  db: pg.Pool | null,
  concurrent: boolean,
): Promise<SimDeliveryResult[]> {
  const send = (scenario: SimScenario): Promise<SimDeliveryResult> => postDelivery(app, scenario, secret, chaos, db);
  const originals = concurrent ? await Promise.all(scenarios.map(send)) : await sendSequential(scenarios, send);
  if (dupes === 0) return originals;
  const duplicates: SimDeliveryResult[] = [];
  for (const scenario of scenarios) {
    for (let attempt = 0; attempt < dupes; attempt += 1) duplicates.push(await send(scenario));
  }
  return [...originals, ...duplicates];
}

async function sendSequential(
  scenarios: readonly SimScenario[],
  send: (scenario: SimScenario) => Promise<SimDeliveryResult>,
): Promise<SimDeliveryResult[]> {
  const results: SimDeliveryResult[] = [];
  for (const scenario of scenarios) results.push(await send(scenario));
  return results;
}

async function durableEventStatus(db: pg.Pool | null, eventId: string): Promise<string | undefined> {
  if (!db) return undefined;
  const result = await db.query<{ status: string; job_count: number }>(
    `SELECT e.status, (SELECT count(*)::int FROM jobs j WHERE j.payload->>'eventId' = e.event_id) AS job_count
     FROM webhook_events e WHERE e.event_id = $1`,
    [eventId],
  );
  const row = result.rows[0];
  return row && Number(row.job_count) === 0 ? row.status : undefined;
}

function summarizeTotals(deliveries: readonly SimDeliveryResult[]): SimTotals {
  return deliveries.reduce<SimTotals>((totals, delivery) => {
    if (delivery.status_code === 429 || delivery.status === 'rate_limited') totals.rate_limited += 1;
    else if (delivery.status === 'accepted') totals.accepted += 1;
    else if (delivery.status === 'duplicate') totals.duplicate += 1;
    else if (delivery.status === 'ignored') totals.ignored += 1;
    else totals.rejected += 1;
    return totals;
  }, { accepted: 0, duplicate: 0, rejected: 0, ignored: 0, rate_limited: 0 });
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.max(1, Math.ceil(sorted.length * fraction));
  return sorted[rank - 1] ?? 0;
}
