import { AEGIS_VERSION, formatInr } from "@aegis/shared";
import { API_URL, getHealth } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Landing page for Task 1: proves the three workspace packages are wired together
 * (web → API over HTTP, web → shared via transpilePackages) and shows the API/DB state honestly.
 * The real Overview (prism hero, KPIs) replaces this in Tasks 18 and 22.
 */
export default async function Home() {
  const result = await getHealth();
  const apiLine = result.reachable
    ? `API ${result.health.version} · ${result.health.status} · db ${result.health.db}` +
      (result.health.error ? ` (${result.health.error})` : "")
    : `API unreachable at ${API_URL} (${result.error})`;
  const tone = !result.reachable ? "text-danger" : result.health.status === "ok" ? "text-ok" : "text-warn";

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-16">
      <section className="flex flex-col gap-3">
        <p className="font-mono text-xs uppercase tracking-widest text-fg-muted">Razorpay AI Intern Buildathon 2026</p>
        <h1 className="text-4xl font-semibold tracking-tight">Aegis</h1>
        <p className="max-w-xl text-lg text-fg-muted">
          One event stream in. Specialised, guard-railed actions out. Every money action explainable, bounded and gated.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-border bg-surface p-5">
          <h2 className="text-sm font-medium text-fg-muted">System status</h2>
          <p className={`mt-2 font-mono text-sm ${tone}`}>{apiLine}</p>
          <p className="mt-1 font-mono text-xs text-fg-muted">shared {AEGIS_VERSION} · web 0.1.0</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-5">
          <h2 className="text-sm font-medium text-fg-muted">Money is integer paise</h2>
          <p className="mt-2 font-mono text-sm">{formatInr(42000000)} · {formatInr(149900)} · {formatInr(-22485)}</p>
          <p className="mt-1 text-xs text-fg-muted">formatted by @aegis/shared with no floating point</p>
        </div>
      </section>

      <section className="rounded-2xl border border-dashed border-border p-5 text-sm text-fg-muted">
        Scaffold state (Task 1). The dashboard — live event feed, action audit trail, approvals, Ask Aegis, compliance,
        x402 lab — is built in Tasks 17–22. See <span className="font-mono">Checklist.md</span>.
      </section>
    </div>
  );
}
