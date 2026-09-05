import type pg from 'pg';
import type { GuardrailConfig } from './types';
import type { ActionProposal, EventContext, GuardRule } from '../orchestrator/types';

const COUNTRY_TIMEZONES: Readonly<Record<string, string>> = {
  IN: 'Asia/Kolkata',
  US: 'America/New_York',
  GB: 'Europe/London',
  AE: 'Asia/Dubai',
  SG: 'Asia/Singapore',
};

/** Evaluate the global kill switch without I/O. */
export function killSwitch(config: Pick<GuardrailConfig, 'kill_switch'>): GuardRule {
  return {
    rule: 'kill_switch',
    limit: false,
    actual: config.kill_switch,
    pass: config.kill_switch === false,
    note: config.kill_switch ? 'all action modules are disabled by the merchant' : undefined,
  };
}

/** Evaluate the per-customer outbound cooldown using a previously loaded timestamp. */
export function cooldown(lastMessageAt: Date | null, now: Date, hours: number): GuardRule {
  const elapsedHours = lastMessageAt === null ? null : Math.max(0, now.getTime() - lastMessageAt.getTime()) / 3_600_000;
  const pass = elapsedHours === null || elapsedHours >= hours;
  return {
    rule: 'message_cooldown_hours',
    limit: hours,
    actual: elapsedHours,
    pass,
    note: pass ? undefined : `last simulated message was ${elapsedHours.toFixed(2)}h ago`,
  };
}

/** Resolve the customer's country to its documented IANA timezone and evaluate quiet hours. */
export function quietHours(country: string | null | undefined, now: Date, bounds: GuardrailConfig['quiet_hours_local']): GuardRule {
  const timezone = COUNTRY_TIMEZONES[country?.toUpperCase() ?? ''] ?? 'Asia/Kolkata';
  const hourText = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', hour12: false }).format(now);
  const hour = Number(hourText) % 24;
  const inQuiet = bounds.start === bounds.end
    ? false
    : bounds.start < bounds.end
      ? hour >= bounds.start && hour < bounds.end
      : hour >= bounds.start || hour < bounds.end;
  return {
    rule: 'quiet_hours_local',
    limit: { ...bounds, timezone },
    actual: { hour, timezone },
    pass: !inQuiet,
    note: inQuiet ? `local hour ${hour} is inside quiet hours` : undefined,
  };
}

/** Enforce the hard daily discount aggregate in integer paise. */
export function dailyDiscountBudget(spentPaise: number, proposal: number, limitPaise: number): GuardRule {
  const candidate = Math.max(0, -proposal);
  const total = spentPaise + candidate;
  return {
    rule: 'daily_discount_budget_paise',
    limit: limitPaise,
    actual: total,
    pass: total <= limitPaise,
    note: total > limitPaise ? 'daily discount budget would be exceeded' : undefined,
  };
}

export const evaluateKillSwitch = killSwitch;
export const evaluateCooldown = cooldown;
export const evaluateQuietHours = quietHours;
export const evaluateDailyDiscountBudget = dailyDiscountBudget;

export async function latestOutboundMessageAt(db: pg.Pool, customerId: string): Promise<Date | null> {
  const result = await db.query<{ created_at: Date | string }>(
    `SELECT m.created_at
     FROM outbound_messages m
     JOIN actions a ON a.id = m.action_id
     WHERE a.customer_id = $1
       AND m.status = 'simulated_sent'
     ORDER BY m.created_at DESC
     LIMIT 1`,
    [customerId],
  );
  const value = result.rows[0]?.created_at;
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function dailyDiscountSpent(db: pg.Pool, now: Date): Promise<number> {
  const result = await db.query<{ spent: number | string | null }>(
    `SELECT COALESCE(SUM(-money_impact_paise), 0)::bigint AS spent
     FROM actions
     WHERE status IN ('approved', 'executed', 'pending_approval')
       AND created_at >= date_trunc('day', $1::timestamptz)
       AND created_at < date_trunc('day', $1::timestamptz) + interval '1 day'`,
    [now],
  );
  const value = result.rows[0]?.spent;
  const spent = typeof value === 'number' ? value : Number(value ?? 0);
  if (!Number.isSafeInteger(spent) || spent < 0) throw new Error(`invalid daily discount spend ${String(value)}`);
  return spent;
}

/** Load all I/O-backed orchestrator rules after proposal generation. */
export async function orchestratorRules(
  db: pg.Pool,
  proposal: ActionProposal,
  ctx: Pick<EventContext, 'config' | 'entity' | 'now'>,
): Promise<GuardRule[]> {
  const customerId = proposal.customerId ?? ctx.entity.customer?.id ?? null;
  const [lastMessageAt, spent] = await Promise.all([
    customerId === null ? Promise.resolve(null) : latestOutboundMessageAt(db, customerId),
    dailyDiscountSpent(db, ctx.now),
  ]);
  return [
    killSwitch(ctx.config),
    cooldown(lastMessageAt, ctx.now, ctx.config.message_cooldown_hours),
    quietHours(ctx.entity.customer?.country, ctx.now, ctx.config.quiet_hours_local),
    dailyDiscountBudget(spent, proposal.moneyImpactPaise, ctx.config.daily_discount_budget_paise),
  ];
}
