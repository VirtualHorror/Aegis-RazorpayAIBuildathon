import type { RazorpayWebhook } from '../razorpay/webhook';
import type { SimIdFactory, SimSeed } from './ids';

export const SIM_SCENARIO_NAMES = [
  'payment_failed_3ds_intl',
  'payment_failed_cart_dropoff',
  'payment_failed_insufficient_funds',
  'payment_failed_intl_not_enabled',
  'payment_captured_after_retry',
  'subscription_pending',
  'subscription_halted',
  'subscription_charged',
  'invoice_expired_b2b',
  'invoice_paid',
  'dispute_created',
  'order_paid',
  'unknown_event',
  'bad_signature',
] as const;

export type SimScenarioName = (typeof SIM_SCENARIO_NAMES)[number];
export type SimScenarioNameOrAll = SimScenarioName | 'all';

export const DEFAULT_SIM_ACCOUNT_ID = 'acc_simulator';
export const DEFAULT_SIM_CREATED_AT = 1_757_000_000;

export interface BuildWebhookInput {
  readonly event: string;
  readonly entityKey: string;
  readonly entity: Record<string, unknown>;
  readonly accountId: string;
  readonly createdAt: number;
}

export interface SimScenarioAttribution {
  readonly orderId?: string;
  readonly priorFailureEventId?: string;
}

export interface SimScenario {
  readonly name: SimScenarioName;
  readonly eventId: string;
  readonly entityKey: string;
  readonly webhook: RazorpayWebhook;
  readonly signatureValid: boolean;
  readonly attribution?: SimScenarioAttribution;
}

export interface ScenarioBuildOptions {
  readonly ids?: SimIdFactory;
  readonly seed?: SimSeed;
  readonly accountId?: string;
  readonly createdAt?: number;
  readonly customerId?: string;
  readonly priorFailureOrderId?: string;
  readonly priorFailureEventId?: string;
  readonly priorFailureCustomerId?: string;
  readonly priorSubscriptionId?: string;
  readonly priorInvoiceId?: string;
}
