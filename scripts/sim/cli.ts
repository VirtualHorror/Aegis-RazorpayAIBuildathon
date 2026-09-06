import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import {
  DEFAULT_SIM_ACCOUNT_ID,
  SIM_SCENARIO_NAMES,
  buildAllScenarios,
  buildContendedBurst,
  buildScenario,
} from '../../packages/shared/src/index';
import type {
  ScenarioBuildOptions,
  SimIdFactory,
  SimScenario,
  SimScenarioName,
  SimSeed,
} from '../../packages/shared/src/index';
import type { CliOptions } from './types';

const DEFAULT_API = 'http://127.0.0.1:4000';
const MAX_DUPES = 1_000;
const MAX_BURST = 10_000;
// Epoch-second bounds for --created-at: 2001-09-09 .. 2100-01-01. Wide enough for any backdating a drill wants,
// narrow enough that a millisecond value pasted by mistake is rejected instead of landing in the year 57000.
const MIN_CREATED_AT = 1_000_000_000;
const MAX_CREATED_AT = 4_102_444_800;
const ID_PATTERN = /^[A-Za-z0-9_.:-]{3,64}$/;

/**
 * Parse the simulator's transport flags.
 * Intent: keep validation deterministic before any network or database work starts.
 * Flow: parse positional scenario -> validate bounded counts, seed and pinned ids -> normalize the target URL and chaos mode.
 */
export function parseCliOptions(): CliOptions {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: process.argv.slice(2),
      allowPositionals: true,
      strict: true,
      options: {
        dupes: { type: 'string' },
        burst: { type: 'string' },
        seed: { type: 'string' },
        api: { type: 'string' },
        chaos: { type: 'string' },
        order: { type: 'string' },
        customer: { type: 'string' },
        'created-at': { type: 'string' },
        contend: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (error) {
    throw new Error(`invalid simulator arguments: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }

  if (parsed.values.help) {
    printUsage();
    process.exit(0);
  }
  const scenario = parsed.positionals[0];
  if (!scenario || parsed.positionals.length > 1) throw new Error('one scenario is required; run `pnpm sim --help`');
  const dupes = parseBoundedInteger(optionString(parsed.values.dupes), 'dupes', 0, MAX_DUPES) ?? 0;
  const burst = parseBoundedInteger(optionString(parsed.values.burst), 'burst', 1, MAX_BURST, true);
  const suppliedSeed = parseSeed(optionString(parsed.values.seed));
  const seed = suppliedSeed ?? randomBytes(4).readUInt32BE(0);
  const apiUrl = normalizeApiUrl(optionString(parsed.values.api) ?? DEFAULT_API);
  const chaos = parseChaos(optionString(parsed.values.chaos) ?? envValue('AEGIS_CHAOS'));
  const contend = parsed.values.contend === true;
  if (contend && burst === undefined) throw new Error('--contend only applies to a burst; pass --burst N');
  const createdAt = parseCreatedAt(optionString(parsed.values['created-at']));
  const orderId = parseEntityId(optionString(parsed.values.order), 'order');
  const customerId = parseEntityId(optionString(parsed.values.customer), 'customer');
  // Intent: `all` and a burst own their own entity ids on purpose (lifecycle linkage / deliberate contention), so a pin
  //         would either be ignored or silently turn a burst into a contended one. Fail loudly instead of pretending.
  if ((orderId !== undefined || customerId !== undefined) && (scenario === 'all' || burst !== undefined)) {
    throw new Error('--order/--customer pin one scenario; they cannot be combined with the all scenario or --burst');
  }
  return { scenario, dupes, burst, contend, seed, apiUrl, chaos, createdAt, orderId, customerId };
}

/**
 * Resolve the timestamp every fixture in this run is stamped with.
 * Intent: a delivery against a running API must carry a live timestamp. The frozen fixture constant belongs to unit
 *         tests; sending it over the wire dates every event about a year in the past, and each time-relative rule
 *         downstream then decides on stale input — recovery attribution requires `executed_at <= created_at`, so a
 *         backdated capture can never be attributed and `money.recovered_paise` stays at zero forever (B-019).
 * Flow: use the current wall-clock second -> let --created-at pin it when a run must be byte-reproducible.
 */
function parseCreatedAt(value: string | undefined): number {
  if (value === undefined) return Math.floor(Date.now() / 1_000);
  const parsed = parseBoundedInteger(value, 'created-at', MIN_CREATED_AT, MAX_CREATED_AT);
  if (parsed === undefined) throw new Error('--created-at must be an epoch-second integer');
  return parsed;
}

/** Validate one pinned entity id before it reaches a signed payload. */
function parseEntityId(value: string | undefined, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (!ID_PATTERN.test(value)) throw new Error(`--${name} must be 3-64 characters of [A-Za-z0-9_.:-]`);
  return value;
}

/**
 * Read the chaos mode from either source.
 * Intent: the documented drill is `AEGIS_CHAOS=llm_down pnpm sim <scenario>`; the flag and the variable must mean the
 *         same thing or that command silently runs a healthy simulation and the drill proves nothing.
 * Flow: prefer an explicit --chaos -> fall back to AEGIS_CHAOS -> accept only the one supported mode.
 */
function parseChaos(value: string | undefined): 'llm_down' | undefined {
  if (value === undefined) return undefined;
  if (value !== 'llm_down') throw new Error(`unsupported chaos mode: ${value}`);
  return value;
}

function envValue(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.length === 0 ? undefined : value;
}

function parseSeed(value: string | undefined): SimSeed | undefined {
  if (value === undefined) return undefined;
  if (value.length === 0) throw new Error('--seed must be a non-empty value');
  if (!/^\d+$/.test(value)) return value;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 0xffff_ffff) {
    throw new Error('--seed must be an integer between 0 and 4294967295, or a non-empty string');
  }
  return parsed;
}

function optionString(value: string | boolean | (string | boolean)[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function parseBoundedInteger(
  value: string | undefined,
  name: string,
  minimum: number,
  maximum: number,
  optional = false,
): number | undefined {
  if (value === undefined) {
    if (optional) return undefined;
    return minimum;
  }
  if (!/^\d+$/.test(value)) throw new Error(`--${name} must be an integer between ${minimum} and ${maximum}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`--${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function normalizeApiUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new Error(`--api must be an absolute URL: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('--api must use http or https');
  // Intent: accept either an API base URL or the exact ingress URL without duplicating the route on trailing slashes.
  // Flow: normalize path separators -> append `/webhooks/razorpay` when needed -> discard query/hash from transport URL.
  const basePath = parsed.pathname.replace(/\/+$/, '');
  parsed.pathname = basePath.endsWith('/webhooks/razorpay') ? basePath : `${basePath}/webhooks/razorpay`;
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

/**
 * Map `--order` / `--customer` onto the builder options one scenario understands.
 * Intent: a capture that recovers an earlier failure has to name that failure's order and customer. `attributeRecovery`
 *         matches an executed action by customer id, payment id or order id; without a pin the retry fixture invents
 *         fresh ids, matches nothing, and the recovered-revenue ledger account is never written (B-019).
 * Flow: retry capture -> the prior-failure fields, which also record the attribution metadata on the fixture;
 *       every other scenario -> the plain entity pins it already supports.
 */
export function linkedOptions(scenario: string, orderId?: string, customerId?: string): ScenarioBuildOptions {
  if (scenario === 'payment_captured_after_retry') {
    return {
      ...(orderId === undefined ? {} : { priorFailureOrderId: orderId }),
      ...(customerId === undefined ? {} : { priorFailureCustomerId: customerId }),
    };
  }
  return {
    ...(orderId === undefined ? {} : { orderId }),
    ...(customerId === undefined ? {} : { customerId }),
  };
}

/**
 * Expand a scenario name into the fixtures to deliver.
 * Intent: `all` preserves lifecycle attribution, while burst mode allocates a distinct event for every request.
 *         `--contend` is the opposite choice on purpose: distinct events cannot deadlock, so proving the B-006 lock
 *         order needs a burst that aims every event at one order and one customer.
 * Flow: special aggregate -> contended or distinct burst -> named builder with one shared seeded ID factory.
 */
export function buildRequestedScenarios(options: CliOptions, ids: SimIdFactory): readonly SimScenario[] {
  const { scenario, burst, contend } = options;
  const base: ScenarioBuildOptions = { ids, accountId: DEFAULT_SIM_ACCOUNT_ID, createdAt: options.createdAt };

  if (scenario === 'all') {
    if (burst !== undefined) throw new Error('--burst cannot be combined with the all scenario');
    return buildAllScenarios(base);
  }

  if (contend) {
    if (burst === undefined) throw new Error('--contend only applies to a burst; pass --burst N');
    if (scenario !== 'burst') throw new Error('--contend applies to the burst scenario, which mixes payment and order events');
    return buildContendedBurst(burst, base);
  }

  if (scenario === 'burst') {
    if (burst === undefined) throw new Error('the burst scenario requires --burst N');
    return Array.from({ length: burst }, () => buildScenario('payment_failed_3ds_intl', base));
  }

  if (!isScenarioName(scenario)) throw new Error(`unknown simulation scenario: ${scenario}`);
  const built: ScenarioBuildOptions = { ...base, ...linkedOptions(scenario, options.orderId, options.customerId) };
  if (burst === undefined) return [buildScenario(scenario, built)];
  return Array.from({ length: burst }, () => buildScenario(scenario, built));
}

function isScenarioName(value: string): value is SimScenarioName {
  return (SIM_SCENARIO_NAMES as readonly string[]).includes(value);
}

export function printUsage(): void {
  console.log('usage: pnpm sim <scenario> [--dupes N] [--burst N] [--contend] [--seed S] [--api URL] [--chaos llm_down]');
  console.log('                          [--order ID] [--customer ID] [--created-at EPOCH_SECONDS]');
  console.log('--contend:    aim every burst event at one order and one customer, so max(attempts)=1 actually proves the lock order');
  console.log('--order/--customer: pin the entity ids one scenario names, so a retry capture can be attributed to the failure it recovered');
  console.log('--created-at: pin the fixture timestamp; the default is the current second, which is what time-relative rules need');
  console.log('AEGIS_CHAOS=llm_down is accepted as an alias for --chaos llm_down');
  console.log(`scenarios: ${[...SIM_SCENARIO_NAMES, 'all', 'burst'].join(', ')}`);
}
