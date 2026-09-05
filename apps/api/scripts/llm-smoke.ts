import { config as loadDotenv } from 'dotenv';
import { loadConfig } from '../src/config';
import { createLlmClient } from '../src/llm/factory';
import { diagnosePaymentFailure } from '../src/llm/prompts';
import { REPO_ROOT_ENV } from '../src/db/paths';

/**
 * Small operator-facing check for the complete provider path. It intentionally uses a harmless masked fixture so the
 * command can be run against a real configured provider without sending customer data (C-A7).
 */
async function main(): Promise<void> {
  loadDotenv({ path: REPO_ROOT_ENV, quiet: true });
  const config = loadConfig();
  const logger = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined };
  const llm = createLlmClient(config, logger);
  const description = llm.describe();
  const user = diagnosePaymentFailure.buildUser({
    hints: { error_step: 'payment_authentication', error_reason: null, amount_band: 'small' },
    payloadMasked: { payment: { id: 'pay_smoke', contact: '+91••••••1234' } },
  });
  const result = await llm.completeJson({
    purpose: 'diagnose_payment_failure',
    system: diagnosePaymentFailure.system,
    user,
    schema: diagnosePaymentFailure.schema,
    tier: 'fast',
  });
  process.stdout.write(`provider=${description.provider} model=${description.model}\n`);
  process.stdout.write(`${JSON.stringify(result.data)}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
