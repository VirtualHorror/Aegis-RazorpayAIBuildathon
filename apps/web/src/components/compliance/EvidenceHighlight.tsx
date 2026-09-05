/**
 * Show the product description with the evidence span marked.
 * Intent: the model must point at words that are actually there (C-A3); when the span is not found verbatim the UI says
 *         so instead of highlighting something approximate.
 */
export function splitOnSpan(description: string | null | undefined, span: string | null): { before: string; match: string; after: string } | null {
  if (!description || !span || span.length === 0) return null;
  const index = description.indexOf(span);
  if (index < 0) return null;
  return { before: description.slice(0, index), match: description.slice(index, index + span.length), after: description.slice(index + span.length) };
}

export function EvidenceHighlight({ description, span }: { description: string | null | undefined; span: string | null }) {
  const parts = splitOnSpan(description, span);
  if (!parts) {
    return (
      <p className="text-sm leading-6">
        {description ?? <span className="text-fg-muted">The product copy is no longer in the catalog.</span>}
        {span ? <span className="ml-2 rounded bg-warn/15 px-1.5 py-0.5 text-xs text-warn">quoted span “{span}” is not in this description</span> : null}
      </p>
    );
  }
  return (
    <p className="text-sm leading-6">
      {parts.before}
      <mark className="rounded bg-warn/25 px-0.5 text-fg">{parts.match}</mark>
      {parts.after}
    </p>
  );
}
