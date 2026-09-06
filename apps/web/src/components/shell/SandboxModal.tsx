"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/Toast";
import { useActor } from "@/lib/actor";
import { api, describeFailure } from "@/lib/api";
import { DEFAULT_SANDBOX, isLive, readSandbox, setSandbox, validateSandbox, type SandboxFieldErrors, type SandboxMode, type SandboxSettings } from "@/lib/sandbox";

const MODES: readonly { value: SandboxMode; label: string; hint: string }[] = [
  { value: "demo", label: "Demo mode", hint: "Simulated Razorpay account and the deployment's own model key." },
  { value: "live", label: "Live mode", hint: "Your Razorpay account, your webhook secret, your model key." },
];

export interface SandboxModalProps {
  onClose: () => void;
}

/**
 * Sandbox / BYOK settings (T25).
 * Intent: turning the prototype into something a merchant can point at their own account needs exactly three values,
 *         and each has a different home: the account id and webhook secret go to the API once (the ingress verifies
 *         that account's deliveries with it), the model key stays in this browser and rides on every request.
 * Flow: open -> draft from localStorage -> toggle Demo/Live -> validate like the API will -> Live: POST the secret and
 *       only then persist the draft locally (a failed save must not leave the browser "live" with an unknown secret)
 *       -> Demo: persist immediately. "Forget keys" clears everything. Mounted only while open, so every opening
 *       re-reads the store and there is no state to reset.
 */
export function SandboxModal({ onClose }: SandboxModalProps) {
  const toast = useToast();
  const actor = useActor();
  const titleId = useId();
  const baseId = useId();
  const firstFieldRef = useRef<HTMLButtonElement>(null);
  const [draft, setDraft] = useState<SandboxSettings>(() => readSandbox());
  const [errors, setErrors] = useState<SandboxFieldErrors>({});
  const [reveal, setReveal] = useState(false);
  const [saving, setSaving] = useState(false);
  const live = isLive(draft);

  useEffect(() => {
    const previous = document.activeElement;
    firstFieldRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [onClose]);

  const update = (patch: Partial<SandboxSettings>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setErrors({});
  };

  const forget = () => {
    setSandbox(DEFAULT_SANDBOX);
    toast.push({ title: "Sandbox keys forgotten", body: "This browser is back in Demo mode. The secret already stored on the API stays until you rotate it.", tone: "neutral" });
    onClose();
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed: SandboxSettings = { mode: draft.mode, accountId: draft.accountId.trim(), webhookSecret: draft.webhookSecret.trim(), llmKey: draft.llmKey.trim() };
    const fieldErrors = validateSandbox(trimmed);
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      const first = Object.keys(fieldErrors)[0];
      document.getElementById(`${baseId}-${first}`)?.focus();
      return;
    }
    if (!isLive(trimmed)) {
      setSandbox(trimmed);
      toast.push({ title: "Demo mode", body: "Requests use the simulated account and the deployment's model key.", tone: "neutral" });
      onClose();
      return;
    }
    setSaving(true);
    const result = await api.saveSandboxKeys({ account_id: trimmed.accountId, webhook_secret: trimmed.webhookSecret, actor });
    setSaving(false);
    if (!result.ok) {
      toast.push({ title: "Could not save the webhook secret", body: describeFailure(result), tone: "danger", duration: 8_000 });
      return;
    }
    setSandbox(trimmed);
    const { sandbox } = result.data;
    toast.push({
      title: `Live mode on for ${sandbox.account_id}`,
      body: `Webhook secret stored as ${sandbox.key} (fingerprint ${sandbox.webhook_secret_fingerprint}).${trimmed.llmKey ? " Your model key is attached to every request from this browser." : " Model calls keep using the deployment's key."}`,
      tone: "ok",
      duration: 9_000,
    });
    onClose();
  };

  const field = (name: keyof SandboxFieldErrors) => ({ id: `${baseId}-${name}`, errorId: `${baseId}-${name}-error`, error: errors[name] });
  const accountField = field("accountId");
  const secretField = field("webhookSecret");
  const llmField = field("llmKey");
  const inputClass = (error: string | undefined) => `h-9 w-full min-w-0 rounded-lg border bg-surface px-2.5 font-mono text-sm text-fg ${error ? "border-danger" : "border-border"}`;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/50" onClick={onClose} />
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={save}
        className="card relative flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-b-none sm:rounded-b-2xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="flex items-center gap-2 text-sm font-medium">
              <Icon name="key" size={16} />
              Sandbox &amp; keys
            </h2>
            <p className="mt-0.5 text-xs text-fg-muted">Run Aegis against the simulated account, or bring your own Razorpay account and model key.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-fg-muted hover:bg-surface-2 hover:text-fg">
            <Icon name="x" size={18} />
          </button>
        </header>

        <div className="scroll-thin flex-1 overflow-y-auto px-5 py-4">
          <div role="radiogroup" aria-label="Sandbox mode" className="grid grid-cols-2 gap-2">
            {MODES.map((option, index) => {
              const active = draft.mode === option.value;
              return (
                <button
                  key={option.value}
                  ref={index === 0 ? firstFieldRef : undefined}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => update({ mode: option.value })}
                  className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${active ? "border-accent bg-accent/10" : "border-border hover:bg-surface-2"}`}
                >
                  <span className={`block text-sm font-medium ${active ? "text-accent" : "text-fg"}`}>{option.label}</span>
                  <span className="mt-0.5 block text-xs text-fg-muted">{option.hint}</span>
                </button>
              );
            })}
          </div>

          {live ? (
            <div className="mt-4 space-y-4">
              <div>
                <label htmlFor={accountField.id} className="text-sm font-medium">
                  Razorpay account id
                </label>
                <p className="mt-0.5 text-xs text-fg-muted">
                  The <span className="font-mono">account_id</span> Razorpay stamps on your webhooks. Deliveries for it are verified with the secret below.
                </p>
                <input
                  id={accountField.id}
                  value={draft.accountId}
                  onChange={(event) => update({ accountId: event.target.value })}
                  placeholder="acc_…"
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={accountField.error ? true : undefined}
                  aria-describedby={accountField.error ? accountField.errorId : undefined}
                  className={`mt-1.5 ${inputClass(accountField.error)}`}
                />
                {accountField.error ? (
                  <p id={accountField.errorId} className="mt-1 text-xs text-danger">
                    {accountField.error}
                  </p>
                ) : null}
              </div>

              <div>
                <label htmlFor={secretField.id} className="text-sm font-medium">
                  Razorpay webhook secret
                </label>
                <p className="mt-0.5 text-xs text-fg-muted">
                  Sent to the API once on save and stored as <span className="font-mono">sandbox_secret_&lt;account_id&gt;</span>; it is never returned or shown again.
                </p>
                <input
                  id={secretField.id}
                  type={reveal ? "text" : "password"}
                  value={draft.webhookSecret}
                  onChange={(event) => update({ webhookSecret: event.target.value })}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={secretField.error ? true : undefined}
                  aria-describedby={secretField.error ? secretField.errorId : undefined}
                  className={`mt-1.5 ${inputClass(secretField.error)}`}
                />
                {secretField.error ? (
                  <p id={secretField.errorId} className="mt-1 text-xs text-danger">
                    {secretField.error}
                  </p>
                ) : null}
              </div>

              <div>
                <label htmlFor={llmField.id} className="text-sm font-medium">
                  OpenAI API key <span className="font-normal text-fg-muted">(optional)</span>
                </label>
                <p className="mt-0.5 text-xs text-fg-muted">
                  Kept in this browser only and attached to every request as <span className="font-mono">x-aegis-llm-key</span>; the API uses it for that request&apos;s model calls and stores nothing. Leave blank to keep the deployment&apos;s model.
                </p>
                <input
                  id={llmField.id}
                  type={reveal ? "text" : "password"}
                  value={draft.llmKey}
                  onChange={(event) => update({ llmKey: event.target.value })}
                  placeholder="sk-…"
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={llmField.error ? true : undefined}
                  aria-describedby={llmField.error ? llmField.errorId : undefined}
                  className={`mt-1.5 ${inputClass(llmField.error)}`}
                />
                {llmField.error ? (
                  <p id={llmField.errorId} className="mt-1 text-xs text-danger">
                    {llmField.error}
                  </p>
                ) : null}
              </div>

              <label className="flex items-center gap-2 text-xs text-fg-muted">
                <input type="checkbox" checked={reveal} onChange={(event) => setReveal(event.target.checked)} className="h-3.5 w-3.5 accent-accent" />
                Show secrets while typing
              </label>
            </div>
          ) : (
            <p className="mt-4 text-xs text-fg-muted">
              Demo mode sends nothing extra. The simulator signs with the deployment&apos;s webhook secret and every model call uses the key in <span className="font-mono">.env</span>.
            </p>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3">
          <Button variant="ghost" size="sm" onClick={forget} disabled={saving}>
            Forget keys
          </Button>
          <div className="flex gap-2">
            <Button onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={saving}>
              {live ? "Save & go live" : "Save"}
            </Button>
          </div>
        </footer>
      </form>
    </div>
  );
}
