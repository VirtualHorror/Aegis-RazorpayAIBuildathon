import type { Metadata } from "next";
import { AskComposer } from "@/components/ask/AskComposer";
import { PageHeader } from "@/components/ui/PageHeader";
import { api, describeFailure } from "@/lib/api";

export const metadata: Metadata = { title: "Ask Aegis" };
export const dynamic = "force-dynamic";

/** Text-to-SQL with the generated SQL always on screen (Checklist 20.1). */
export default async function AskPage() {
  const history = await api.askHistory(20);
  return (
    <>
      <PageHeader
        title="Ask Aegis"
        description="Ask in plain language. The model writes SQL, a parser validates it against an allowlist, and a read-only role without access to personal data runs it."
      />
      <AskComposer initialHistory={history.ok ? history.data.items : []} historyError={history.ok ? null : describeFailure(history)} />
    </>
  );
}
