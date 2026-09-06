import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import {
  createIdFactory,
} from '../packages/shared/src/index';
import { buildRequestedScenarios, parseCliOptions } from './sim/cli';
import { printResults } from './sim/output';
import { createDbInspector, verifyBadSignatureNamespace, verifyBurst, verifyOriginalDeliveries } from './sim/verification';
import { prepareScenario, sendScenarios } from './sim/transport';

/**
 * Drive the real webhook endpoint with deterministic, signed fixtures.
 * Intent: keep this entrypoint thin; parsing, transport, presentation, and durable checks each live in a focused module.
 * Flow: load environment -> parse flags -> build fixtures once -> deliver -> inspect -> print evidence.
 */
async function main(): Promise<void> {
  const options = parseCliOptions();
  const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  loadDotenv({ path: join(repoRoot, '.env'), quiet: true });

  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) throw new Error('RAZORPAY_WEBHOOK_SECRET is required; set it in .env or the environment');

  console.log(`seed=${options.seed}`);
  console.log(`api=${options.apiUrl}`);
  // Printed so a run can be replayed byte-for-byte with `--seed S --created-at T`; the default is the current second.
  console.log(`created_at=${options.createdAt} (${new Date(options.createdAt * 1_000).toISOString()})`);

  const ids = createIdFactory(options.seed);
  const scenarios = buildRequestedScenarios(options, ids);
  const prepared = scenarios.map((scenario) => prepareScenario(scenario, secret, options.chaos));
  const inspector = createDbInspector();
  try {
    const results = await sendScenarios(prepared, options, inspector);
    printResults(results);
    verifyOriginalDeliveries(results, options.seed);
    await verifyBadSignatureNamespace(results, prepared, inspector);
    if (options.burst !== undefined) await verifyBurst(results, prepared, inspector, options.contend);
  } finally {
    await inspector?.close();
  }
}

main().catch((error: unknown) => {
  console.error(`simulator error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
