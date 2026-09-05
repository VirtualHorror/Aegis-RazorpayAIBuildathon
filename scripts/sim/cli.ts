import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import {
  SIM_SCENARIO_NAMES,
  buildAllScenarios,
  buildContendedBurst,
  buildScenario,
} from '../../packages/shared/src/index';
import type {
  createIdFactory,
  SimScenario,
  SimScenarioName,
  SimSeed,
} from '../../packages/shared/src/index';
import type { CliOptions } from './types';

const DEFAULT_API = 'http://127.0.0.1:4000';
const CREATED_AT = 1_757_000_000;
const MAX_DUPES = 1_000;
const MAX_BURST = 10_000;

/**
 * Parse the simulator's transport flags.
 * Intent: keep validation deterministic before any network or database work starts.
 * Flow: parse positional scenario -> validate bounded counts and seed -> normalize the target URL and chaos mode.
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
  const chaosValue = optionString(parsed.values.chaos);
  if (chaosValue !== undefined && chaosValue !== 'llm_down') throw new Error(`unsupported chaos mode: ${chaosValue}`);
  const contend = parsed.values.contend === true;
  if (contend && burst === undefined) throw new Error('--contend only applies to a burst; pass --burst N');
  return { scenario, dupes, burst, contend, seed, apiUrl, chaos: chaosValue };
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
 * Expand a scenario name into the fixtures to deliver.
 * Intent: `all` preserves lifecycle attribution, while burst mode allocates a distinct event for every request.
 *         `--contend` is the opposite choice on purpose: distinct events cannot deadlock, so proving the B-006 lock
 *         order needs a burst that aims every event at one order and one customer.
 * Flow: special aggregate -> contended or distinct burst -> named builder with one shared seeded ID factory.
 */
export function buildRequestedScenarios(
  scenario: string,
  burst: number | undefined,
  ids: ReturnType<typeof createIdFactory>,
  contend = false,
): readonly SimScenario[] {
  if (scenario === 'all') {
    if (burst !== undefined) throw new Error('--burst cannot be combined with the all scenario');
    return buildAllScenarios({ ids, accountId: 'acc_simulator', createdAt: CREATED_AT });
  }

  if (contend) {
    if (burst === undefined) throw new Error('--contend only applies to a burst; pass --burst N');
    if (scenario !== 'burst') throw new Error('--contend applies to the burst scenario, which mixes payment and order events');
    return buildContendedBurst(burst, { ids, accountId: 'acc_simulator', createdAt: CREATED_AT });
  }

  if (scenario === 'burst') {
    if (burst === undefined) throw new Error('the burst scenario requires --burst N');
    return Array.from({ length: burst }, () => buildScenario('payment_failed_3ds_intl', { ids, accountId: 'acc_simulator', createdAt: CREATED_AT }));
  }

  if (!isScenarioName(scenario)) throw new Error(`unknown simulation scenario: ${scenario}`);
  if (burst === undefined) return [buildScenario(scenario, { ids, accountId: 'acc_simulator', createdAt: CREATED_AT })];
  return Array.from({ length: burst }, () => buildScenario(scenario, { ids, accountId: 'acc_simulator', createdAt: CREATED_AT }));
}

function isScenarioName(value: string): value is SimScenarioName {
  return (SIM_SCENARIO_NAMES as readonly string[]).includes(value);
}

export function printUsage(): void {
  console.log('usage: pnpm sim <scenario> [--dupes N] [--burst N] [--contend] [--seed S] [--api URL] [--chaos llm_down]');
  console.log('--contend: aim every burst event at one order and one customer, so max(attempts)=1 actually proves the lock order');
  console.log(`scenarios: ${[...SIM_SCENARIO_NAMES, 'all', 'burst'].join(', ')}`);
}
