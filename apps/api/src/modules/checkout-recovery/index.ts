import {
  formatInr,
  WhatsAppTemplateMessageSchema,
  type WhatsAppTemplateMessage,
} from '@aegis/shared';
import { maskContact } from '../../llm/mask';
import type {
  ActionModule,
  ActionProposal,
  ActionRow,
  EventContext,
  ExecutionDeps,
  ExecutionResult,
} from '../../orchestrator/types';
import { guardCheckoutRecovery, paymentAmountPaise, CHECKOUT_RECOVERY_STRATEGIES, type CheckoutRecoveryStrategy } from './rules';
import { retryLink } from './links';
import { localeForTemplates, templatesFor } from './templates';

const KIND_BY_STRATEGY: Readonly<Record<CheckoutRecoveryStrategy, string>> = {
  RETRY_LINK_LOCALIZED: 'whatsapp_retry_link',
  RETRY_ALTERNATE_METHOD: 'whatsapp_alt_method',
  CART_RECOVERY_NUDGE: 'whatsapp_cart_nudge',
};

function isCheckoutRecoveryStrategy(value: string | undefined): value is CheckoutRecoveryStrategy {
  return value !== undefined && (CHECKOUT_RECOVERY_STRATEGIES as readonly string[]).includes(value);
}

function strategyTemplate(strategy: CheckoutRecoveryStrategy): 'retry_link' | 'alt_method' | 'cart_nudge' {
  switch (strategy) {
    case 'RETRY_LINK_LOCALIZED':
      return 'retry_link';
    case 'RETRY_ALTERNATE_METHOD':
      return 'alt_method';
    case 'CART_RECOVERY_NUDGE':
      return 'cart_nudge';
  }
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function maskedRecipient(value: string): string {
  // Seed fixtures use asterisks while production masking uses bullets; normalize both to one audit representation.
  return maskContact(value).replaceAll('*', '•');
}

function actionPayload(action: ActionRow): WhatsAppTemplateMessage {
  const proposal = objectRecord(action.proposal);
  const candidate = proposal !== null && Object.prototype.hasOwnProperty.call(proposal, 'payload')
    ? proposal.payload
    : action.proposal;
  return WhatsAppTemplateMessageSchema.parse(candidate);
}

function buttonLink(payload: WhatsAppTemplateMessage): string {
  const button = payload.template.components[1];
  const parameter = button.parameters[0];
  return parameter.text;
}

function localeFromLanguageCode(code: string): string {
  return code.includes('_') ? code.replace('_', '-') : code;
}

/**
 * Checkout recovery sends one pre-approved, localised WhatsApp template for a failed payment.
 * Intent: strategy, amount, locale and link are all deterministic; no model output enters customer-facing copy.
 * Flow: canHandle -> propose immutable template payload -> pure module guard -> simulated execution/audit.
 */
export class CheckoutRecovery implements ActionModule {
  readonly name = 'checkout_recovery';
  readonly version = 'v1';
  readonly handles = ['payment.failed'] as const;

  canHandle(ctx: EventContext): boolean {
    const strategy = ctx.diagnosis?.strategy;
    const customer = ctx.entity.customer;
    return ctx.event.event_type === 'payment.failed'
      && ctx.entity.type === 'payment'
      && ctx.diagnosis !== null
      && isCheckoutRecoveryStrategy(strategy)
      && customer !== null
      && customer !== undefined;
  }

  async propose(ctx: EventContext): Promise<ActionProposal | null> {
    if (!this.canHandle(ctx)) return null;
    const diagnosis = ctx.diagnosis;
    const customer = ctx.entity.customer;
    if (
      diagnosis === null
      || customer === null
      || customer === undefined
      || !isCheckoutRecoveryStrategy(diagnosis.strategy)
      || typeof customer.contact !== 'string'
      || customer.contact.trim().length === 0
    ) return null;

    const amountPaise = paymentAmountPaise(ctx);
    const locale = localeForTemplates(customer.locale);
    const templates = templatesFor(locale);
    const strategy = diagnosis.strategy;
    const spec = templates[strategyTemplate(strategy)];
    const link = retryLink(ctx.entity.row.id, ctx.now);
    const amount = formatInr(amountPaise);
    const recipientMasked = maskedRecipient(customer.contact ?? '');
    const payload = WhatsAppTemplateMessageSchema.parse({
      messaging_product: 'whatsapp',
      to: recipientMasked,
      type: 'template',
      template: {
        name: spec.name,
        language: { code: spec.language },
        components: [
          { type: 'body', parameters: spec.bodyParams({ amount, link }).map((text) => ({ type: 'text', text })) },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: spec.buttonUrl(link) }],
          },
        ],
      },
    });

    return {
      module: this.name,
      moduleVersion: this.version,
      idempotencyKey: `${this.name}:payment:${ctx.entity.row.id}:1`,
      entityType: 'payment',
      entityId: ctx.entity.row.id,
      ...(customer.id.length > 0 ? { customerId: customer.id } : {}),
      kind: KIND_BY_STRATEGY[strategy],
      summary: `Send a ${locale} WhatsApp checkout recovery message for ${amount}`,
      moneyImpactPaise: 0,
      expectedRecoveryPaise: amountPaise,
      requiresApproval: false,
      payload,
      explanation: [
        diagnosis.rationale,
        `Locale ${locale} selected from the customer's persisted preference.`,
        `Retry link is deterministic for payment ${ctx.entity.row.id} on ${ctx.now.toISOString().slice(0, 10)}: ${link}`,
      ],
    };
  }

  guard(proposal: ActionProposal, ctx: EventContext) {
    return guardCheckoutRecovery(proposal, ctx);
  }

  async execute(action: ActionRow, _ctx: EventContext, _deps: ExecutionDeps): Promise<ExecutionResult> {
    const payload = actionPayload(action);
    const link = buttonLink(payload);
    return {
      status: 'executed',
      result: { link },
      outbound: {
        channel: 'whatsapp',
        recipientMasked: maskedRecipient(payload.to),
        locale: localeFromLanguageCode(payload.template.language.code),
        template: payload.template.name,
        payload,
        status: 'simulated_sent',
      },
    };
  }

  async compensate(action: ActionRow, deps: ExecutionDeps): Promise<void> {
    const payload = actionPayload(action);
    // Intent: compensation is append-only and visibly records that the simulated message was suppressed.
    // Flow: derive the same masked recipient/template -> insert a suppressed outbound row; action history is retained.
    await deps.db.query(
      `INSERT INTO outbound_messages
         (action_id, channel, recipient_masked, locale, template, payload, status, suppressed_reason)
       VALUES ($1, 'whatsapp', $2, $3, $4, $5::jsonb, 'suppressed', 'compensated')`,
      [action.id, maskedRecipient(payload.to), localeFromLanguageCode(payload.template.language.code), payload.template.name, JSON.stringify(payload)],
    );
  }
}

export const checkoutRecovery = new CheckoutRecovery();
export { CheckoutRecovery as CheckoutRecoveryModule };
export const checkoutRecoveryModule = checkoutRecovery;
export default checkoutRecovery;
