"use client";

import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/ui/icons";
import { isLive } from "@/lib/sandbox";
import { useSandbox } from "@/lib/useSandbox";
import { SandboxModal } from "./SandboxModal";

/**
 * Top-bar entry point for Sandbox / BYOK mode (T25). Shows which account this browser is driving and opens the modal.
 * The label comes from localStorage through `useSandbox`, so the server render says "Demo mode" and the client
 * corrects it after hydration without a mismatch. The modal is portalled to `document.body`: the top bar's
 * `backdrop-blur` makes it a containing block for `position: fixed`, so a dialog rendered inside it would be centred
 * on the 56px header instead of the viewport. Below `md` the pill is icon-only like the kill-switch pill next to it:
 * the 360px top bar has about 10px to spare (C-F3), so the account id is carried by the accessible name there.
 */
export function SandboxPill() {
  const sandbox = useSandbox();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const live = isLive(sandbox);
  const label = live ? `Live · ${sandbox.accountId}` : "Demo mode";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}, open sandbox settings`}
        title={live ? `Live mode: webhooks for ${sandbox.accountId} verify with your secret${sandbox.llmKey ? "; your model key is attached to requests" : ""}. Click to change.` : "Demo mode: simulated account and the deployment's model key. Click to bring your own keys."}
        className={`inline-flex h-7 max-w-[11rem] shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 text-[11px] font-medium transition-colors ${live ? "border-accent bg-accent/10 text-accent" : "border-border text-fg-muted hover:text-fg"}`}
      >
        <Icon name="key" size={13} />
        <span className="hidden truncate md:inline" aria-hidden>
          {label}
        </span>
      </button>
      {open ? createPortal(<SandboxModal onClose={close} />, document.body) : null}
    </>
  );
}
