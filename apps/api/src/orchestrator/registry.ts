import type { ActionModule } from './types';
import { checkoutRecovery } from '../modules/checkout-recovery';
import { noopModule } from '../modules/noop';
import { subscriptionSalvager } from '../modules/subscription-salvager';

export interface ModuleRegistryOptions {
  readonly disabled?: string | readonly string[];
  readonly modules?: readonly ActionModule[];
}

/** Build the deterministic module list and apply the development kill list once at boot. */
export function createModuleRegistry(options: ModuleRegistryOptions = {}): readonly ActionModule[] {
  const all = options.modules ?? [checkoutRecovery, subscriptionSalvager, noopModule];
  const disabled = new Set(
    typeof options.disabled === 'string'
      ? options.disabled.split(',').map((name) => name.trim()).filter((name) => name.length > 0)
      : options.disabled ?? [],
  );
  return all.filter((module) => !disabled.has(module.name));
}

export const moduleRegistry = createModuleRegistry;
