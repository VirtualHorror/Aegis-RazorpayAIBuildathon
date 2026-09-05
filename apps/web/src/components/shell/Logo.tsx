/** The prism mark: one beam in, the module spectrum out (Design.md §1). */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3.5l8.5 16h-17L12 3.5z" stroke="currentColor" strokeWidth={1.6} />
      <path d="M1 11.5h7.5" stroke="currentColor" strokeWidth={1.6} />
      <path d="M14.5 12l8-3.2" stroke="var(--mod-checkout_recovery)" strokeWidth={1.4} />
      <path d="M14.5 12.4l8-1.4" stroke="var(--mod-subscription_salvager)" strokeWidth={1.4} />
      <path d="M14.5 12.8l8 .4" stroke="var(--mod-b2b_negotiator)" strokeWidth={1.4} />
      <path d="M14.5 13.2l8 2.2" stroke="var(--mod-chargeback_evidence)" strokeWidth={1.4} />
      <path d="M14.5 13.6l8 4" stroke="var(--mod-x402)" strokeWidth={1.4} />
    </svg>
  );
}
