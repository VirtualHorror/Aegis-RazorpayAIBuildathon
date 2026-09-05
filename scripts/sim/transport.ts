import { createHash } from 'node:crypto';
import { computeSignature } from './signer';
import { inspectEvent } from './verification';
import type { CliOptions, DbInspector, DeliveryCategory, DeliveryResult, PreparedScenario } from './types';
import type { SimScenario } from '../../packages/shared/src/index';

export function prepareScenario(scenario: SimScenario, secret: string, chaos: 'llm_down' | undefined): PreparedScenario {
  // Intent: sign exactly the bytes sent over fetch so raw-body verification cannot diverge from serialization.
  // Flow: serialize once -> compute signature/body hash -> reuse the same Buffer and headers for every duplicate.
  const raw = Buffer.from(JSON.stringify(scenario.webhook));
  const signature = scenario.signatureValid ? computeSignature(raw, secret) : '0'.repeat(64);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-razorpay-signature': signature,
    'x-razorpay-event-id': scenario.eventId,
  };
  if (chaos) headers['x-aegis-chaos'] = chaos;
  const bodyHash = createHash('sha256').update(raw).digest('hex');
  return { scenario, raw, headers, unverifiedKey: `unverified:${bodyHash}` };
}

/**
 * Deliver originals and optional duplicate replays.
 * Intent: burst originals are concurrent, while duplicate replays stay sequential and byte-identical.
 * Flow: send originals -> send each prepared item's exact body/headers N additional times -> combine results.
 */
export async function sendScenarios(
  prepared: readonly PreparedScenario[],
  options: CliOptions,
  inspector: DbInspector | undefined,
): Promise<DeliveryResult[]> {
  const originals = options.burst === undefined
    ? await sendSequential(prepared, options.apiUrl, inspector)
    : await Promise.all(prepared.map((item) => sendOne(item, options.apiUrl, inspector)));
  if (options.dupes === 0) return originals;

  const duplicates: DeliveryResult[] = [];
  for (const item of prepared) {
    for (let index = 0; index < options.dupes; index += 1) duplicates.push(await sendOne(item, options.apiUrl, inspector));
  }
  return [...originals, ...duplicates];
}

async function sendSequential(
  prepared: readonly PreparedScenario[],
  apiUrl: string,
  inspector: DbInspector | undefined,
): Promise<DeliveryResult[]> {
  const results: DeliveryResult[] = [];
  for (const item of prepared) results.push(await sendOne(item, apiUrl, inspector));
  return results;
}

async function sendOne(item: PreparedScenario, apiUrl: string, inspector: DbInspector | undefined): Promise<DeliveryResult> {
  const started = performance.now();
  let response: Response;
  try {
    response = await fetch(apiUrl, { method: 'POST', headers: item.headers, body: item.raw, signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    throw new Error(`simulator could not reach ${apiUrl}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const latencyMs = Math.max(0, Math.round(performance.now() - started));
  const body = await parseResponse(response);
  const responseStatus = typeof body.status === 'string'
    ? body.status
    : response.status === 401 ? 'rejected' : response.status === 429 ? 'rate_limited' : 'error';
  const category = await classifyDelivery(item, response.status, responseStatus, body, inspector);
  return {
    scenario: item.scenario.name,
    statusCode: response.status,
    status: category === 'ignored' ? 'ignored' : category === 'rate_limited' ? 'rate_limited' : category === 'rejected' ? 'rejected' : responseStatus,
    category,
    eventId: item.scenario.eventId,
    latencyMs,
  };
}

async function parseResponse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch (error) {
    throw new Error(`API returned a non-JSON response (${response.status}): ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

async function classifyDelivery(
  item: PreparedScenario,
  statusCode: number,
  responseStatus: string,
  body: Record<string, unknown>,
  inspector: DbInspector | undefined,
): Promise<DeliveryCategory> {
  if (statusCode === 429) return 'rate_limited';
  if (statusCode === 401 || responseStatus === 'rejected') return 'rejected';
  if (responseStatus === 'duplicate') return 'duplicate';
  if (item.scenario.webhook.event === 'settlement.processed' && responseStatus === 'accepted') {
    const durable = await inspectEvent(inspector, item.scenario.eventId);
    if (!durable) {
      throw new Error(`could not verify unknown_event ${item.scenario.eventId} in webhook_events; DATABASE_URL is required for ignored classification`);
    }
    if (durable.status === 'ignored' && durable.jobCount === 0) return 'ignored';
    throw new Error(`unknown_event ${item.scenario.eventId} was not persisted as ignored with zero jobs`);
  }
  if (responseStatus === 'accepted' && statusCode >= 200 && statusCode < 300) return 'accepted';
  if (body.error === 'invalid_signature') return 'rejected';
  return statusCode >= 400 ? 'rejected' : 'accepted';
}
