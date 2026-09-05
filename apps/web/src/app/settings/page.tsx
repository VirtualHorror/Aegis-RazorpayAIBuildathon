import type { Metadata } from "next";
import { SettingsView } from "@/components/settings/SettingsView";
import { PageHeader } from "@/components/ui/PageHeader";
import { api, describeFailure } from "@/lib/api";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

/** Guardrails, the kill switch and the audit trail of changes (Checklist 21.2). */
export default async function SettingsPage() {
  const [guardrails, history] = await Promise.all([api.guardrails(), api.guardrailHistory()]);
  return (
    <>
      <PageHeader title="Settings" description="The bounds every module reads before it proposes anything. Each change is audited with the name you are deciding as." />
      <SettingsView
        initialGuardrails={guardrails.ok ? guardrails.data.items : []}
        initialHistory={history.ok ? history.data.items : []}
        error={guardrails.ok ? null : describeFailure(guardrails)}
      />
    </>
  );
}
