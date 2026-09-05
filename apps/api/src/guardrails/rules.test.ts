import { describe, expect, it } from 'vitest';
import { cooldown, dailyDiscountBudget, killSwitch, quietHours } from './rules';

describe('orchestrator guardrail rules', () => {
  const now = new Date('2026-09-05T18:00:00.000Z');

  it('blocks every proposal while kill switch is true', () => {
    expect(killSwitch({ kill_switch: true })).toMatchObject({ rule: 'kill_switch', pass: false, actual: true });
    expect(killSwitch({ kill_switch: false }).pass).toBe(true);
  });

  it('blocks a customer inside the message cooldown', () => {
    expect(cooldown(new Date(now.getTime() - 23 * 3_600_000), now, 24).pass).toBe(false);
    expect(cooldown(new Date(now.getTime() - 24 * 3_600_000), now, 24).pass).toBe(true);
    expect(cooldown(null, now, 24).pass).toBe(true);
  });

  it('uses the country timezone and handles a quiet interval crossing midnight', () => {
    const bounds = { start: 21, end: 8 } as const;
    expect(quietHours('IN', new Date('2026-09-05T17:00:00.000Z'), bounds).pass).toBe(false); // 22:30 IST
    expect(quietHours('US', new Date('2026-09-05T02:00:00.000Z'), bounds).pass).toBe(false); // 22:00 New York
    expect(quietHours('IN', new Date('2026-09-05T10:00:00.000Z'), bounds).pass).toBe(true); // 15:30 IST
  });

  it('hard-stops a discount that would exceed the daily budget', () => {
    expect(dailyDiscountBudget(4_900, -100, 5_000).pass).toBe(true);
    expect(dailyDiscountBudget(4_900, -101, 5_000)).toMatchObject({ pass: false, actual: 5_001 });
  });
});
