"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/icons";
import { JsonView } from "@/components/ui/JsonView";
import { useToast } from "@/components/ui/Toast";
import { API_URL, api, apiFetch, describeFailure } from "@/lib/api";
import { formatInr } from "@/lib/format";
import { useStreamEffect } from "@/lib/sse";
import type { GuardrailRow, X402Challenge, X402PaymentRow, X402Product } from "@/lib/types";
import { CapsPanel } from "./CapsPanel";
import { SettlementTable } from "./SettlementTable";
import { Stepper, type Step } from "./Stepper";

export interface X402LabProps {
  products: X402Product[];
  initialPayments: X402PaymentRow[];
  guardrails: GuardrailRow[];
  error: string | null;
}

interface StepResult {
  status: number;
  body: unknown;
  paymentResponse?: unknown;
}

function decodePaymentResponse(header: string | null): unknown {
  if (!header) return null;
  try {
    return JSON.parse(atob(header));
  } catch (error) {
    return { raw: header, decodeError: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * The x402 flow as three visible HTTP exchanges (Checklist 21.1).
 * Flow: 1) GET the product spec with no header → 402 + challenge; 2) the server signs an `X-PAYMENT` header for that
 *       nonce (the facilitator secret never reaches the browser) and the same GET returns 200 with a decoded
 *       `X-PAYMENT-RESPONSE`; 3) replaying the same header is rejected because the nonce is already settled.
 */
export function X402Lab({ products, initialPayments, guardrails, error }: X402LabProps) {
  const toast = useToast();
  const [productId, setProductId] = useState(products[0]?.id ?? "prod_001");
  const [payer, setPayer] = useState("agent:dashboard");
  const [challenge, setChallenge] = useState<StepResult | null>(null);
  const [paid, setPaid] = useState<StepResult | null>(null);
  const [replay, setReplay] = useState<StepResult | null>(null);
  const [header, setHeader] = useState<string | null>(null);
  const [busy, setBusy] = useState<"challenge" | "pay" | "replay" | null>(null);
  const [payments, setPayments] = useState(initialPayments);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());

  const product = products.find((entry) => entry.id === productId);
  const accepted = challenge && typeof challenge.body === "object" && challenge.body !== null ? (challenge.body as X402Challenge).accepts?.[0] : undefined;

  async function refreshPayments(): Promise<void> {
    const result = await api.x402Payments();
    if (result.ok) setPayments(result.data.items);
  }

  useStreamEffect(["x402.settled", "x402.rejected"], (event) => {
    const data = event.data;
    const nonce = typeof data === "object" && data !== null && "nonce" in data && typeof data.nonce === "string" ? data.nonce : null;
    if (nonce) {
      setFresh((current) => new Set(current).add(nonce));
      setTimeout(() => setFresh((current) => {
        const copy = new Set(current);
        copy.delete(nonce);
        return copy;
      }), 1_500);
    }
    void refreshPayments();
  });

  const reset = () => {
    setChallenge(null);
    setPaid(null);
    setReplay(null);
    setHeader(null);
  };

  const requestChallenge = async () => {
    setBusy("challenge");
    reset();
    const result = await apiFetch<unknown>(`/x402/products/${encodeURIComponent(productId)}/spec`);
    setBusy(null);
    if (result.ok) {
      // A 200 here means the resource is not actually gated; show it rather than pretending a challenge happened.
      setChallenge({ status: result.status, body: result.data });
      toast.push({ title: "No payment was required", body: "The gateway answered 200 without a challenge.", tone: "warn" });
      return;
    }
    setChallenge({ status: result.status, body: result.body ?? { error: result.error } });
    await refreshPayments();
  };

  const pay = async () => {
    if (!accepted) return;
    setBusy("pay");
    const signed = await api.signX402({ nonce: accepted.extra.nonce, amount: accepted.maxAmountRequired, payer });
    if (!signed.ok) {
      setBusy(null);
      toast.push({ title: "Could not sign the payment", body: describeFailure(signed), tone: "danger" });
      return;
    }
    setHeader(signed.data.header);
    const result = await apiFetch<unknown>(`/x402/products/${encodeURIComponent(productId)}/spec`, { headers: { "X-PAYMENT": signed.data.header } });
    setBusy(null);
    setPaid({
      status: result.status,
      body: result.ok ? result.data : (result.body ?? { error: result.error }),
      paymentResponse: decodePaymentResponse(result.headers?.get("X-PAYMENT-RESPONSE") ?? null),
    });
    await refreshPayments();
  };

  const replayPayment = async () => {
    if (!header) return;
    setBusy("replay");
    const result = await apiFetch<unknown>(`/x402/products/${encodeURIComponent(productId)}/spec`, { headers: { "X-PAYMENT": header } });
    setBusy(null);
    setReplay({ status: result.status, body: result.ok ? result.data : (result.body ?? { error: result.error }) });
    await refreshPayments();
  };

  const steps: Step[] = [
    { title: "Ask without paying", body: "The gateway answers 402 with the price, the pay-to address and a one-time nonce.", state: challenge ? (challenge.status === 402 ? "done" : "failed") : busy === "challenge" ? "active" : "todo" },
    { title: "Pay and retry", body: "The server signs an X-PAYMENT header for that nonce; the same request now returns 200.", state: paid ? (paid.status === 200 ? "done" : "failed") : challenge?.status === 402 ? (busy === "pay" ? "active" : "todo") : "todo" },
    { title: "Replay the same payment", body: "The nonce is already settled, so the gateway refuses it.", state: replay ? (replay.status === 402 ? "done" : "failed") : paid?.status === 200 ? (busy === "replay" ? "active" : "todo") : "todo" },
  ];

  return (
    <div className="flex flex-col gap-4">
      {error ? <p className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p> : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex flex-col gap-1 text-xs text-fg-muted">
          <span>Product an agent wants</span>
          <select className="h-9 rounded-lg border border-border bg-surface px-2.5 text-sm text-fg" value={productId} onChange={(event) => { setProductId(event.target.value); reset(); }}>
            {products.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name} — {formatInr(entry.price_paise)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-fg-muted">
          <span>Buyer identity</span>
          <input className="h-9 w-56 rounded-lg border border-border bg-surface px-2.5 font-mono text-xs text-fg" value={payer} onChange={(event) => setPayer(event.target.value)} aria-label="Buyer identity" />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={requestChallenge} loading={busy === "challenge"} icon={<Icon name="coins" size={14} />}>
            1 · Request without paying
          </Button>
          <Button onClick={pay} loading={busy === "pay"} disabled={challenge?.status !== 402 || busy !== null}>
            2 · Pay and retry
          </Button>
          <Button onClick={replayPayment} loading={busy === "replay"} disabled={paid?.status !== 200 || busy !== null}>
            3 · Replay
          </Button>
        </div>
      </div>

      <Stepper steps={steps} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
          {challenge ? (
            <Card title={`HTTP ${challenge.status} · challenge`} description={`GET ${API_URL}/x402/products/${productId}/spec with no X-PAYMENT header`} actions={<Badge tone={challenge.status === 402 ? "warn" : "danger"}>{challenge.status}</Badge>}>
              <JsonView value={challenge.body} label="402 challenge" maxHeight={260} />
              {accepted ? (
                <p className="mt-2 text-xs text-fg-muted">
                  Price {formatInr(Number(accepted.maxAmountRequired))} · pay to <span className="font-mono">{accepted.payTo}</span> · nonce expires {new Date(accepted.extra.expiresAt).toLocaleTimeString()}
                </p>
              ) : null}
            </Card>
          ) : null}

          {paid ? (
            <Card title={`HTTP ${paid.status} · paid`} description="The same request, now carrying a signed X-PAYMENT header" actions={<Badge tone={paid.status === 200 ? "ok" : "danger"}>{paid.status}</Badge>}>
              <JsonView value={paid.body} label="Paid response" maxHeight={200} />
              {paid.paymentResponse ? (
                <div className="mt-3">
                  <h3 className="mb-1 text-xs text-fg-muted">X-PAYMENT-RESPONSE (decoded)</h3>
                  <JsonView value={paid.paymentResponse} label="Decoded payment response" maxHeight={160} />
                </div>
              ) : null}
            </Card>
          ) : null}

          {replay ? (
            <Card title={`HTTP ${replay.status} · replay`} description="The identical header, sent a second time" actions={<Badge tone={replay.status === 402 ? "ok" : "danger"}>{replay.status}</Badge>}>
              <JsonView value={replay.body} label="Replay response" maxHeight={160} />
            </Card>
          ) : null}

          {!challenge ? (
            <Card title="What this shows">
              <p className="text-sm leading-6">
                An AI buyer asks for {product ? product.name : "a product"} and gets a price instead of a login. It pays, retries, and the same URL answers with the goods. If it tries to spend the same
                payment twice, the gateway refuses. Settlement is simulated: every row below is labelled <span className="font-mono">aegis-sim</span> and no money moves.
              </p>
            </Card>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <CapsPanel guardrails={guardrails} payments={payments} />
          {header ? (
            <Card title="Signed header" description="Built by the server; the facilitator secret never reaches the browser.">
              <pre className="scroll-thin max-h-24 overflow-auto break-all rounded-xl bg-surface-2 p-3 font-mono text-[11px] leading-4">{header}</pre>
            </Card>
          ) : null}
        </div>
      </div>

      <section aria-labelledby="settlements">
        <h2 id="settlements" className="mb-2 text-sm font-medium">
          Settlements ({payments.length})
        </h2>
        <SettlementTable payments={payments} fresh={fresh} />
      </section>
    </div>
  );
}
