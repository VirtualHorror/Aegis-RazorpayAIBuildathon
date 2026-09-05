import type { RazorpayWebhook } from '@aegis/shared';
import type { Pool } from 'pg';
import type { Diagnosis, WebhookEventRow } from '../diagnosis/diagnostician';
import type { LlmClient } from '../llm/client';
import type { GuardrailConfig } from '../guardrails/types';
import type { EntitySnapshot } from './entity';
import type { EventBus } from '../bus/event-bus';

/** The logger surface shared by the worker, orchestrator, and action modules. */
export interface Logger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
}

export type Db = Pool;

export type EntityType = 'payment' | 'order' | 'subscription' | 'invoice' | 'dispute';

export interface EventContext {
  event: WebhookEventRow;
  payload: RazorpayWebhook;
  entity: EntitySnapshot;
  diagnosis: Diagnosis | null;
  config: GuardrailConfig;
  now: Date;
  logger: Logger;
}

export interface ActionProposal {
  module: string;
  moduleVersion: string;
  idempotencyKey: string;
  entityType: EntityType;
  entityId: string;
  customerId?: string;
  kind: string;
  summary: string;
  moneyImpactPaise: number;
  expectedRecoveryPaise: number;
  requiresApproval: boolean;
  payload: Record<string, unknown>;
  explanation: string[];
  scheduleFollowUp?: { kind: string; runAt: Date; payload: Record<string, unknown>; dedupeKey: string };
}

export interface GuardRule { rule: string; limit: unknown; actual: unknown; pass: boolean; note?: string }
export interface GuardResult { pass: boolean; rules: GuardRule[]; blockedReason?: string }

export interface ActionRow {
  readonly id: string;
  readonly idempotency_key: string;
  readonly module: string;
  readonly module_version: string;
  readonly trigger_event_id: string | null;
  readonly diagnosis_id: string | null;
  readonly entity_type: EntityType;
  readonly entity_id: string;
  readonly customer_id: string | null;
  readonly kind: string;
  readonly summary: string;
  readonly proposal: Record<string, unknown>;
  readonly bounds: GuardRule[];
  readonly money_impact_paise: number;
  readonly expected_recovery_paise: number;
  readonly requires_approval: boolean;
  readonly status: ActionStatus;
  readonly reason: string | null;
  readonly decided_by: string | null;
  readonly decided_at: Date | null;
  readonly executed_at: Date | null;
  readonly result: Record<string, unknown> | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export type ActionStatus = 'proposed' | 'blocked' | 'pending_approval' | 'approved' | 'rejected' | 'executed' | 'failed' | 'expired' | 'compensated';

export interface OutboundMessageDraft {
  channel: 'whatsapp' | 'email' | 'sms';
  recipientMasked: string;
  locale: string;
  template: string;
  payload: Record<string, unknown>;
  status?: 'simulated_sent' | 'suppressed';
  suppressedReason?: string;
}

export interface LedgerEntryDraft {
  account: string;
  debitPaise?: number;
  creditPaise?: number;
  currency?: string;
  refType: string;
  refId: string;
  memo?: string;
}

export interface ExecutionDeps { db: Db; bus: EventBus; llm: LlmClient; now: Date; logger: Logger }
export interface ExecutionResult {
  status: 'executed' | 'failed';
  result: Record<string, unknown>;
  outbound?: OutboundMessageDraft;
  ledger?: LedgerEntryDraft[];
  error?: string;
}

export interface ActionModule {
  readonly name: string;
  readonly version: string;
  readonly handles: readonly string[];
  canHandle(ctx: EventContext): boolean;
  propose(ctx: EventContext): Promise<ActionProposal | null>;
  guard(proposal: ActionProposal, ctx: EventContext): GuardResult;
  execute(action: ActionRow, ctx: EventContext, deps: ExecutionDeps): Promise<ExecutionResult>;
  compensate?(action: ActionRow, deps: ExecutionDeps): Promise<void>;
}

/** A persisted ingress row shape used by orchestration and diagnostics. */
export type { WebhookEventRow };
