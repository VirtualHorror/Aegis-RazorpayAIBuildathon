import type pg from 'pg';
import type { LlmClient } from '../llm/client';
import type { ActionModule } from './types';
import { checkoutRecovery } from '../modules/checkout-recovery';
import { noopModule } from '../modules/noop';
import { subscriptionSalvager } from '../modules/subscription-salvager';
import { B2BNegotiator, b2bNegotiator } from '../modules/b2b-negotiator';

export interface ModuleRegistryOptions {
  readonly disabled?: string | readonly string[];
  readonly modules?: readonly ActionModule[];
  readonly db?: pg.Pool;
  readonly llm?: LlmClient;
}

/** Build the deterministic module list and apply the development kill list once at boot. */
export function createModuleRegistry(options: ModuleRegistryOptions = {}): readonly ActionModule[] {
  const all = options.modules ?? [checkoutRecovery, subscriptionSalvager, options.llm ? new B2BNegotiator(options.llm) : b2bNegotiator, noopModule];
  const disabled = new Set(
    typeof options.disabled === 'string'
      ? options.disabled.split(',').map((name) => name.trim()).filter((name) => name.length > 0)
      : options.disabled ?? [],
  );
  return all.filter((module) => !disabled.has(module.name));
}

export const moduleRegistry = createModuleRegistry;
