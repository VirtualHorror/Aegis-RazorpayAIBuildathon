import { idsFor, customerFor, createdAtFor, makeScenario } from './support';
import type { ScenarioBuildOptions, SimScenario } from './types';

function invoiceEntity(
  ids: ReturnType<typeof idsFor>,
  options: ScenarioBuildOptions,
  status: 'expired' | 'paid',
  invoiceId: string,
): Record<string, unknown> {
  return {
    entity: 'invoice', id: invoiceId, customer_id: customerFor(options, ids), amount: 42_000_000,
    amount_paid: status === 'paid' ? 42_000_000 : 0, amount_due: status === 'paid' ? 0 : 42_000_000,
    currency: 'INR', status, due_by: createdAtFor(options) - 86_400,
    line_items: [{ name: 'Enterprise annual plan', amount: 42_000_000, quantity: 1 }],
    // The merchant's stated floor: ₹3,57,000 of the ₹4,20,000 invoice. Without it the projection sets floor = amount
    // and the negotiator has no room to discount at all, so a B2B fixture that cannot negotiate proves nothing (B-014).
    notes: { segment: 'b2b', locale: 'en-IN', floor_amount_paise: 35_700_000 },
  };
}

export function buildInvoiceExpiredB2b(options: ScenarioBuildOptions = {}): SimScenario {
  const ids = idsFor(options);
  const scenarioOptions = { ...options, ids };
  return makeScenario('invoice_expired_b2b', 'invoice.expired', 'invoice', invoiceEntity(
    ids, scenarioOptions, 'expired', options.priorInvoiceId ?? ids.invoiceId(),
  ), scenarioOptions);
}

export function buildInvoicePaid(options: ScenarioBuildOptions = {}): SimScenario {
  const ids = idsFor(options);
  const scenarioOptions = { ...options, ids };
  return makeScenario('invoice_paid', 'invoice.paid', 'invoice', invoiceEntity(
    ids, scenarioOptions, 'paid', options.priorInvoiceId ?? ids.invoiceId(),
  ), scenarioOptions);
}
