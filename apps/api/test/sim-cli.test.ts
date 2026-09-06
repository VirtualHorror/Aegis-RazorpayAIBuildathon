import { afterEach, describe, expect, it } from 'vitest';
import { createIdFactory, DEFAULT_SIM_CREATED_AT, type SimScenario } from '@aegis/shared';
import { buildRequestedScenarios, linkedOptions, parseCliOptions } from '../../../scripts/sim/cli';
import type { CliOptions } from '../../../scripts/sim/types';

/** Read one field out of a built fixture's entity without widening the shared package's public surface for a test. */
function entityField(scenario: SimScenario | undefined, key: string, field: string): string | undefined {
  const wrapped = scenario?.webhook.payload[key];
  if (typeof wrapped !== 'object' || wrapped === null || !('entity' in wrapped)) return undefined;
  const entity = wrapped.entity;
  if (typeof entity !== 'object' || entity === null) return undefined;
  const value = Object.entries(entity).find(([entryKey]) => entryKey === field)?.[1];
  return typeof value === 'string' ? value : undefined;
}

const BASE: CliOptions = {
  scenario: 'payment_failed_3ds_intl',
  dupes: 0,
  burst: undefined,
  contend: false,
  seed: 42,
  apiUrl: 'http://127.0.0.1:4000/webhooks/razorpay',
  chaos: undefined,
  createdAt: 1_800_000_000,
  orderId: undefined,
  customerId: undefined,
};

const originalArgv = process.argv;
const originalChaos = process.env.AEGIS_CHAOS;

function withArgv<T>(args: readonly string[], run: () => T): T {
  process.argv = ['node', 'simulate.ts', ...args];
  try {
    return run();
  } finally {
    process.argv = originalArgv;
  }
}

afterEach(() => {
  process.argv = originalArgv;
  if (originalChaos === undefined) delete process.env.AEGIS_CHAOS;
  else process.env.AEGIS_CHAOS = originalChaos;
});

describe('simulator CLI timestamps', () => {
  // B-019: the frozen fixture constant dates every delivery about a year in the past, and `attributeRecovery`
  // requires `executed_at <= created_at`, so a backdated capture can never credit recovered revenue.
  it('stamps a live run with the current second, not the frozen fixture constant', () => {
    const before = Math.floor(Date.now() / 1_000);
    const options = withArgv(['payment_failed_3ds_intl'], parseCliOptions);
    const after = Math.floor(Date.now() / 1_000);
    expect(options.createdAt).toBeGreaterThanOrEqual(before);
    expect(options.createdAt).toBeLessThanOrEqual(after);
    expect(options.createdAt).not.toBe(DEFAULT_SIM_CREATED_AT);
  });

  it('pins the fixture timestamp when --created-at is given, and rejects a millisecond value', () => {
    expect(withArgv(['payment_failed_3ds_intl', '--created-at', '1757000000'], parseCliOptions).createdAt).toBe(1_757_000_000);
    expect(() => withArgv(['payment_failed_3ds_intl', '--created-at', '1757000000000'], parseCliOptions)).toThrow(/created-at/);
  });

  it('carries the resolved timestamp into every built fixture', () => {
    const [scenario] = buildRequestedScenarios(BASE, createIdFactory(BASE.seed));
    expect(scenario?.webhook.created_at).toBe(1_800_000_000);
  });
});

describe('simulator CLI chaos mode', () => {
  it('accepts AEGIS_CHAOS as an alias for --chaos, so the documented drill runs as written', () => {
    process.env.AEGIS_CHAOS = 'llm_down';
    expect(withArgv(['payment_failed_3ds_intl'], parseCliOptions).chaos).toBe('llm_down');
  });

  it('rejects an unsupported mode from either source', () => {
    process.env.AEGIS_CHAOS = 'db_down';
    expect(() => withArgv(['payment_failed_3ds_intl'], parseCliOptions)).toThrow(/unsupported chaos mode: db_down/);
    delete process.env.AEGIS_CHAOS;
    expect(() => withArgv(['payment_failed_3ds_intl', '--chaos', 'db_down'], parseCliOptions)).toThrow(/unsupported chaos mode/);
  });

  it('lets an explicit flag win over the environment', () => {
    process.env.AEGIS_CHAOS = 'llm_down';
    expect(withArgv(['payment_failed_3ds_intl', '--chaos', 'llm_down'], parseCliOptions).chaos).toBe('llm_down');
  });
});

describe('simulator CLI entity pins', () => {
  it('pins the order and customer a normal scenario names', () => {
    const options: CliOptions = { ...BASE, orderId: 'order_demo_1', customerId: 'cus_demo_1' };
    const [scenario] = buildRequestedScenarios(options, createIdFactory(options.seed));
    expect(entityField(scenario, 'payment', 'order_id')).toBe('order_demo_1');
    expect(entityField(scenario, 'payment', 'customer_id')).toBe('cus_demo_1');
  });

  // The retry capture is the reason the pins exist: it must name the failed attempt's order and customer, and record
  // the attribution metadata, or the recovered-revenue ledger account is never written (B-019).
  it('maps the pins onto the retry capture prior-failure fields and records attribution', () => {
    const options: CliOptions = { ...BASE, scenario: 'payment_captured_after_retry', orderId: 'order_demo_1', customerId: 'cus_demo_1' };
    const [scenario] = buildRequestedScenarios(options, createIdFactory(options.seed));
    expect(entityField(scenario, 'payment', 'order_id')).toBe('order_demo_1');
    expect(entityField(scenario, 'payment', 'customer_id')).toBe('cus_demo_1');
    expect(scenario?.attribution?.orderId).toBe('order_demo_1');
    expect(linkedOptions('payment_captured_after_retry', 'order_demo_1', 'cus_demo_1')).toEqual({
      priorFailureOrderId: 'order_demo_1',
      priorFailureCustomerId: 'cus_demo_1',
    });
  });

  it('allocates fresh ids when no pin is given', () => {
    const [scenario] = buildRequestedScenarios(BASE, createIdFactory(BASE.seed));
    expect(entityField(scenario, 'payment', 'order_id')).toMatch(/^order_/);
    expect(entityField(scenario, 'payment', 'customer_id')).toMatch(/^cus_/);
  });

  it('refuses a pin that the all scenario or a burst would silently ignore', () => {
    expect(() => withArgv(['all', '--order', 'order_demo_1'], parseCliOptions)).toThrow(/cannot be combined/);
    expect(() => withArgv(['payment_failed_3ds_intl', '--burst', '5', '--customer', 'cus_demo_1'], parseCliOptions)).toThrow(/cannot be combined/);
  });

  it('rejects an id that is not safe to put in a signed payload', () => {
    expect(() => withArgv(['payment_failed_3ds_intl', '--order', 'order 1'], parseCliOptions)).toThrow(/--order must be/);
    expect(() => withArgv(['payment_failed_3ds_intl', '--customer', 'ab'], parseCliOptions)).toThrow(/--customer must be/);
  });
});
