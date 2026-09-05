import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  SIM_SCENARIO_NAMES,
  buildAllScenarios,
  buildContendedBurst,
  buildScenario,
  createIdFactory,
  type SimScenario,
  type SimScenarioName,
} from '@aegis/shared';
import type { Config } from '../config';
import { computeSignature } from '../ingress/signature';
import { signPayment } from '../x402/canonical';
import type pg from 'pg';

const SimRequestSchema = z.object({
  scenario: z.string().min(1).default('all'),
  dupes: z.number().int().nonnegative().max(1_000).optional().default(0),
  burst: z.number().int().positive().max(10_000).optional(),
  seed: z.union([
    z.number().int().nonnegative().max(0xffff_ffff),
    z.string().min(1),
  ]).optional(),
  contend: z.boolean().optional().default(false),
  chaos: z.literal('llm_down').optional(),
});

// Intent: one unauthenticated development request must not be able to schedule unbounded work. `burst` and `dupes`
//         multiply, so their product -- not either bound on its own -- is what has to be capped before anything is sent.
// Flow: build the fixture list -> reject the request when originals x (1 + dupes) exceeds this -> only then deliver.
const MAX_SIM_DELIVERIES = 2_000;

export interface SimRouteOptions {
  config: Pick<Config, 'RAZORPAY_WEBHOOK_SECRET'> & Partial<Pick<Config, 'X402_SIM_SECRET' | 'X402_PAY_TO'>>;
  db: pg.Pool | null;
}

// Intent: the x402 Lab needs a signed X-PAYMENT header, and the simulated facilitator's secret must never reach the
//         browser (C-D3). The browser sends the challenge it received; the server signs it and returns only the header.
// Flow: parse the challenge fields -> HMAC the canonical string with X402_SIM_SECRET -> base64 the envelope -> reply.
const X402SignSchema = z.object({
  nonce: z.string().min(1).max(200),
  amount: z.string().regex(/^\d{1,15}$/, 'amount must be integer paise as a string'),
  payer: z.string().min(1).max(120).default('agent:dashboard'),
  payTo: z.string().min(1).max(200).optional(),
  issuedAt: z.iso.datetime().optional(),
});

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
  /** Development-only signing helper for the dashboard's x402 Lab; the secret stays on the server. */
  app.post('/sim/x402-sign', async (request, reply) => {
    const parsed = X402SignSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      await reply.code(400).send({ error: 'invalid_x402_sign_request', details: parsed.error.issues });
      return;
    }
    const secret = options.config.X402_SIM_SECRET;
    if (!secret) {
      await reply.code(503).send({ error: 'x402_signing_unavailable', details: 'X402_SIM_SECRET is not configured' });
      return;
    }
    const payload = {
      nonce: parsed.data.nonce,
      amount: parsed.data.amount,
      asset: 'INR' as const,
      payTo: parsed.data.payTo ?? options.config.X402_PAY_TO ?? 'merchant:aegis-demo',
      payer: parsed.data.payer,
      issuedAt: parsed.data.issuedAt ?? new Date().toISOString(),
    };
    const signature = signPayment(payload, secret);
    const envelope = { x402Version: 1 as const, scheme: 'exact' as const, network: 'aegis-sim' as const, payload: { ...payload, signature } };
    return { header: Buffer.from(JSON.stringify(envelope)).toString('base64'), payload: { ...payload, signature: `${signature.slice(0, 8)}…` } };
  });

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
      scenarios = buildRequestedScenarios(input.scenario, input.burst, ids, input.contend);
    } catch (error) {
      await reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
      return;
    }

    const deliveryCount = scenarios.length * (1 + input.dupes);
    if (deliveryCount > MAX_SIM_DELIVERIES) {
      await reply.code(400).send({
        error: 'simulation_too_large',
        details: `${deliveryCount} deliveries exceeds the ${MAX_SIM_DELIVERIES} limit for this route; use the CLI for larger runs`,
      });
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

function buildRequestedScenarios(
  scenario: string,
  burst: number | undefined,
  ids: ReturnType<typeof createIdFactory>,
  contend: boolean,
): readonly SimScenario[] {
  if (scenario === 'all') {
    if (burst !== undefined) throw new Error('--burst cannot be combined with the all scenario');
    return buildAllScenarios({ ids });
  }

  // Intent: keep the route and the CLI on one definition of a contended burst (D-036), including its guard rails.
  if (contend) {
    if (burst === undefined) throw new Error('contend only applies to a burst; pass burst');
    if (scenario !== 'burst') throw new Error('contend applies to the burst scenario, which mixes payment and order events');
    return buildContendedBurst(burst, { ids });
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
