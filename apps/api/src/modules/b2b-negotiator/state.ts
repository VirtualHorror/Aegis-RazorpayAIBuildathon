export const NEGOTIATION_STATES = ['none', 'offer_sent', 'countered', 'accepted', 'rejected', 'expired', 'escalated'] as const;
export type NegotiationState = (typeof NEGOTIATION_STATES)[number];
export type NegotiationEvent = 'expired_invoice' | 'offer_sent' | 'counter_received' | 'accepted' | 'rejected' | 'timeout' | 'max_rounds';

/** Pure bounded negotiation transition table; terminal outcomes never move silently. */
export function nextNegotiationState(current: NegotiationState, event: NegotiationEvent, round: number, maxRounds: number): NegotiationState | null {
  if (!Number.isSafeInteger(round) || !Number.isSafeInteger(maxRounds) || round < 0 || maxRounds < 0) return null;
  if (current === 'accepted' || current === 'rejected' || current === 'escalated') return null;
  if (event === 'max_rounds') return round >= maxRounds ? 'escalated' : null;
  if (event === 'rejected') return 'rejected';
  switch (current) {
    case 'none': return event === 'expired_invoice' ? 'offer_sent' : null;
    case 'offer_sent':
      if (event === 'counter_received') return 'countered';
      if (event === 'accepted') return 'accepted';
      if (event === 'timeout') return 'expired';
      if (event === 'offer_sent') return 'offer_sent';
      return null;
    case 'countered': return event === 'offer_sent' ? 'offer_sent' : event === 'accepted' ? 'accepted' : null;
    case 'expired': return event === 'expired_invoice' || event === 'offer_sent' ? 'offer_sent' : null;
  }
}
