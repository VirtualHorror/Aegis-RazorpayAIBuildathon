import type { Pool } from 'pg';
import type { RazorpayWebhook } from '@aegis/shared';
import { insertDiagnosis, type DiagnosisRow } from '../db/repos/diagnoses';
import type { EntitySnapshot } from '../orchestrator/entity';
import type { LlmClient } from '../llm/client';
import { LlmUnavailableError } from '../llm/client';
import {
  diagnosePaymentFailure,
  diagnoseSubscriptionFailure,
  inputDigest,
  type DiagnoseInput as PromptInput,
  type DiagnoseOutput,
} from '../llm/prompts';
import { maskPii } from '../llm/mask';
import { crossCheck, type CrossCheckMetadata } from './cross-check';
import { deriveHints, type Hints } from './hints';
import { fallbackDiagnosis, ruleBasedDiagnosis } from './fallback';
import type { RootCause, Strategy } from './schema';

/** The persisted ingress fields needed by the diagnostician; projection workers can pass their row directly. */
export interface WebhookEventRow {
  readonly event_id: string;
  readonly event_type: string;
  readonly payload: unknown;
  readonly signature_valid: boolean;
  readonly rzp_created_at: Date | null;
  readonly status: string;
}

export interface DiagnosticianInput {
  readonly event: WebhookEventRow;
  readonly payload: RazorpayWebhook;
  readonly entity: EntitySnapshot;
  /** The caller's already-computed count of earlier failures for this customer in the last 24 hours. */
  readonly priorFailures24h?: number;
}

export interface DiagnosticianOptions {
  /** A pool is deliberate: the model call must not hold projection row locks (C-A6). */
  readonly db: Pool;
  readonly llm: LlmClient;
  /** Optional caller-supplied history count; defaults to zero when no query is available. */
  readonly priorFailures24h?: number;
  /** Injectable history lookup for the worker/orchestrator without coupling hints to SQL. */
  readonly getPriorFailures24h?: (input: DiagnosticianInput) => number | Promise<number>;
}

export interface Diagnosis {
  readonly id: string;
  readonly rootCause: RootCause;
  readonly strategy: Strategy;
  readonly confidence: number;
  readonly rationale: string;
  readonly degraded: boolean;
  readonly degradedReason?: string;
  readonly crossCheck: CrossCheckMetadata;
  readonly provider: string;
  readonly model: string;
}

type PriorFailures = number | ((input: DiagnosticianInput) => number | Promise<number>);

/**
 * Combine deterministic hints, one validated model call, cross-check rules, and durable audit persistence.
 * Intent: diagnosis is an orchestration boundary, not a projection concern; no model request runs in a transaction.
 * Flow: derive hints -> build a recursively masked prompt -> call the JSON client -> cross-check/fallback -> insert row.
 */
export class Diagnostician {
  private readonly db: Pool;
  private readonly llm: LlmClient;
  private readonly priorFailures: PriorFailures;

  constructor(options: DiagnosticianOptions);
  constructor(db: Pool, llm: LlmClient, priorFailures24h?: PriorFailures);
  constructor(
    optionsOrDb: DiagnosticianOptions | Pool,
    llm?: LlmClient,
    priorFailures24h?: PriorFailures,
  ) {
    if (isOptions(optionsOrDb)) {
      this.db = optionsOrDb.db;
      this.llm = optionsOrDb.llm;
      this.priorFailures = optionsOrDb.getPriorFailures24h ?? optionsOrDb.priorFailures24h ?? 0;
      return;
    }
    if (!llm) throw new TypeError('Diagnostician requires an LlmClient');
    this.db = optionsOrDb;
    this.llm = llm;
    this.priorFailures = priorFailures24h ?? 0;
  }

  async diagnose(input: DiagnosticianInput): Promise<Diagnosis> {
    const prompt = promptFor(input.event.event_type, input.entity.type);
    // History lookup is only needed for a diagnosis that will be persisted. A stale event must remain cheap and
    // side-effect free even when the caller's history repository is unavailable.
    const priorFailures24h = input.entity.applied
      ? await this.resolvePriorFailures(input)
      : input.priorFailures24h ?? 0;
    const hints = deriveHints(input.payload, input.entity as EntitySnapshot & { type: 'payment' | 'subscription' }, priorFailures24h);

    // Intent: stale/duplicate projections must not create another diagnosis row or spend a model call.
    // Flow: detect the precedence result -> apply deterministic rules locally -> return an explicit non-persisted result.
    if (!input.entity.applied) {
      const checked = crossCheck(ruleBasedOutput(hints), hints);
      return toSkippedDiagnosis(input.event.event_id, checked.output, checked.crossCheck);
    }

    const payloadMasked = maskPii(input.payload);
    const entityMasked = maskPii(input.entity);
    const promptInput: PromptInput = { hints: { ...hints }, payloadMasked, entity: entityMasked };
    const user = prompt.buildUser(promptInput);
    const digest = inputDigest(prompt.system, user);

    let modelOutput: DiagnoseOutput;
    let provider: string;
    let model: string;
    let degraded = false;
    let degradedReason: string | undefined;
    let latencyMs: number | null = null;
    let tokensIn: number | null = null;
    let tokensOut: number | null = null;

    try {
      const result = await this.llm.completeJson({
        purpose: prompt.purpose,
        system: prompt.system,
        user,
        schema: prompt.schema,
        tier: 'default',
      });
      modelOutput = result.data;
      provider = result.provider;
      model = result.model;
      latencyMs = result.latencyMs;
      tokensIn = result.tokensIn;
      tokensOut = result.tokensOut;
    } catch (error) {
      if (!(error instanceof LlmUnavailableError)) throw error;
      const fallback = fallbackDiagnosis(hints, error);
      // Keep degraded/provider metadata in dedicated SQL columns; the JSON output remains the same bounded shape as
      // a validated provider response so downstream readers never mistake fallback bookkeeping for model output.
      modelOutput = ruleBasedDiagnosis(hints);
      provider = fallback.provider;
      model = fallback.model;
      degraded = true;
      degradedReason = fallback.degradedReason;
    }

    const checked = crossCheck(modelOutput, hints);
    const output: Record<string, unknown> = {
      ...checked.output,
      cross_check: checked.crossCheck,
    };
    const row = await insertDiagnosis(this.db, {
      eventId: input.event.event_id,
      entityType: input.entity.type,
      entityId: input.entity.row.id,
      hints: { ...hints },
      provider,
      model,
      promptVersion: prompt.version,
      inputDigest: digest,
      output,
      rootCause: checked.rootCause,
      confidence: checked.output.confidence,
      strategy: checked.strategy,
      rationale: checked.output.rationale,
      degraded,
      degradedReason: degradedReason ?? null,
      latencyMs,
      tokensIn,
      tokensOut,
    });
    return toDiagnosis(row, checked.crossCheck);
  }

  private async resolvePriorFailures(input: DiagnosticianInput): Promise<number> {
    const supplied = input.priorFailures24h;
    if (supplied !== undefined) return supplied;
    const value = typeof this.priorFailures === 'function' ? await this.priorFailures(input) : this.priorFailures;
    return value;
  }
}

/** Factory alias keeps composition code independent from the concrete class name. */
export function createDiagnostician(options: DiagnosticianOptions): Diagnostician {
  return new Diagnostician(options);
}

interface DiagnosisPrompt {
  readonly purpose: 'diagnose_payment_failure' | 'diagnose_subscription_failure';
  readonly version: string;
  readonly system: string;
  readonly buildUser: (input: PromptInput) => string;
  readonly schema: typeof diagnosePaymentFailure.schema;
}

function promptFor(eventType: string, entityType: EntitySnapshot['type']): DiagnosisPrompt {
  if (eventType === 'payment.failed' && entityType === 'payment') {
    return { ...diagnosePaymentFailure, purpose: 'diagnose_payment_failure' };
  }
  if ((eventType === 'subscription.pending' || eventType === 'subscription.halted') && entityType === 'subscription') {
    return { ...diagnoseSubscriptionFailure, purpose: 'diagnose_subscription_failure' };
  }
  throw new Error(`unsupported diagnosis event ${eventType} for entity ${entityType}`);
}

function ruleBasedOutput(hints: Hints): DiagnoseOutput {
  return ruleBasedDiagnosis(hints);
}

function toSkippedDiagnosis(eventId: string, output: DiagnoseOutput, crossCheckMetadata: CrossCheckMetadata): Diagnosis {
  return {
    id: `skipped:${eventId}`,
    rootCause: output.root_cause,
    strategy: output.intervention_strategy,
    confidence: output.confidence,
    rationale: output.rationale,
    degraded: true,
    degradedReason: 'entity_not_applied',
    crossCheck: {
      overridden: true,
      notes: ['entity.applied=false; stale or duplicate event was not persisted', ...crossCheckMetadata.notes],
    },
    provider: 'skipped',
    model: 'rules-v1',
  };
}

function toDiagnosis(row: DiagnosisRow, crossCheckMetadata: CrossCheckMetadata): Diagnosis {
  return {
    id: row.id,
    rootCause: row.root_cause,
    strategy: row.strategy,
    confidence: row.confidence,
    rationale: row.rationale,
    degraded: row.degraded,
    ...(row.degraded_reason === null ? {} : { degradedReason: row.degraded_reason }),
    crossCheck: crossCheckMetadata,
    provider: row.provider,
    model: row.model,
  };
}

function isOptions(value: DiagnosticianOptions | Pool): value is DiagnosticianOptions {
  return typeof value === 'object' && value !== null && 'db' in value && 'llm' in value;
}
