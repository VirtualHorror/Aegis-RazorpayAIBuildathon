import type { Metadata } from "next";
import { X402Lab } from "@/components/x402/X402Lab";
import { PageHeader } from "@/components/ui/PageHeader";
import { api, describeFailure } from "@/lib/api";

export const metadata: Metadata = { title: "x402 Lab" };
export const dynamic = "force-dynamic";

/** Agentic commerce: challenge, pay, replay — three real HTTP exchanges (Checklist 21.1). */
export default async function X402Page() {
  const [catalog, payments, guardrails] = await Promise.all([api.x402Catalog(), api.x402Payments(), api.guardrails()]);
  return (
    <>
      <PageHeader
        title="x402 Lab"
        description="Sell to an AI buyer over plain HTTP: a 402 challenge with a price and a one-time nonce, a signed payment, and a replay the gateway refuses. Settlement is simulated end to end."
      />
      <X402Lab
        products={catalog.ok ? catalog.data.items : []}
        initialPayments={payments.ok ? payments.data.items : []}
        guardrails={guardrails.ok ? guardrails.data.items : []}
        error={catalog.ok ? null : describeFailure(catalog)}
      />
    </>
  );
}
