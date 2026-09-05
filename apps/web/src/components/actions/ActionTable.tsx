"use client";

import { ACTION_STATUSES, MODULE_NAMES } from "@aegis/shared";
import { useRouter } from "next/navigation";
import { useState, type CSSProperties } from "react";
import { RunDemoButton } from "@/components/shell/RunDemoButton";
import { useSystem } from "@/components/shell/SystemProvider";
import { Badge, statusTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { GlowInput } from "@/components/ui/GlowInput";
import { Icon } from "@/components/ui/icons";
import { Table, TableWrap, Td, Th, Tr } from "@/components/ui/Table";
import { useToast } from "@/components/ui/Toast";
import { mergeActionEvent, type ActionFilters } from "@/lib/actions";
import { api, describeFailure } from "@/lib/api";
import { formatInr, humanize, moduleColorVar } from "@/lib/format";
import { useStreamEffect } from "@/lib/sse";
import type { ActionListRow, Paged } from "@/lib/types";
import { timeAgo, useNow } from "@/lib/useNow";
import { ActionDrawer } from "./ActionDrawer";
import { ModuleBadge } from "./ModuleBadge";

export interface ActionTableProps {
  initial: Paged<ActionListRow>;
  filters: ActionFilters;
  error: string | null;
}

const SELECT = "h-9 rounded-lg border border-border bg-surface px-2.5 text-sm text-fg";

function matches(row: ActionListRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;
  return [row.id, row.summary, row.kind, row.entity_id, row.module, row.trigger_event_id ?? ""].some((value) => value.toLowerCase().includes(needle));
}

/** Audit trail (Checklist 19.1): filters in the URL, live rows from the bus, drawer for the detail. */
export function ActionTable({ initial, filters, error }: ActionTableProps) {
  const router = useRouter();
  const toast = useToast();
  const system = useSystem();
  const now = useNow();
  const [rows, setRows] = useState(initial.items);
  const [next, setNext] = useState(initial.next);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useStreamEffect(["action.proposed", "action.blocked", "action.pending_approval", "action.executed", "action.failed", "action.rejected"], (event) => {
    let changed: string | null = null;
    setRows((current) => {
      const result = mergeActionEvent(current, event, filters);
      changed = result.changed;
      return result.changed ? result.rows : current;
    });
    const id = changed;
    if (id) {
      setFresh((current) => new Set(current).add(id));
      setTimeout(() => setFresh((current) => {
        const copy = new Set(current);
        copy.delete(id);
        return copy;
      }), 1_200);
    }
  });

  const apply = (nextFilters: ActionFilters) => {
    const params = new URLSearchParams();
    if (nextFilters.status) params.set("status", nextFilters.status);
    if (nextFilters.module) params.set("module", nextFilters.module);
    const query = params.toString();
    router.push(query ? `/actions?${query}` : "/actions");
  };

  const loadMore = async () => {
    if (!next) return;
    setLoadingMore(true);
    const result = await api.actions({ ...filters, limit: 50, before: next });
    setLoadingMore(false);
    if (!result.ok) {
      toast.push({ title: "Could not load more actions", body: describeFailure(result), tone: "danger" });
      return;
    }
    setRows((current) => {
      const seen = new Set(current.map((row) => row.id));
      return [...current, ...result.data.items.filter((row) => !seen.has(row.id))];
    });
    setNext(result.data.next);
  };

  const visible = rows.filter((row) => matches(row, search));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <GlowInput compact value={search} onChange={setSearch} onSubmit={setSearch} label="Search loaded actions" placeholder="Search by id, summary, entity or event" leading={<Icon name="search" size={14} />} submitLabel="Search" />
        </div>
        <label className="flex items-center gap-2 text-xs text-fg-muted">
          <span>Status</span>
          <select className={SELECT} value={filters.status ?? ""} onChange={(event) => apply({ ...filters, status: event.target.value || undefined })}>
            <option value="">All statuses</option>
            {ACTION_STATUSES.map((status) => (
              <option key={status} value={status}>
                {humanize(status)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-fg-muted">
          <span>Module</span>
          <select className={SELECT} value={filters.module ?? ""} onChange={(event) => apply({ ...filters, module: event.target.value || undefined })}>
            <option value="">All modules</option>
            {MODULE_NAMES.map((module) => (
              <option key={module} value={module}>
                {humanize(module)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <EmptyState title="The actions list could not be loaded" body={error} action={<Button onClick={() => window.location.reload()}>Try again</Button>} />
      ) : visible.length === 0 ? (
        <EmptyState
          title={rows.length === 0 ? "No actions match" : "No loaded action matches that search"}
          body={rows.length === 0 ? "Actions are proposed when a webhook needs a response. Run the demo, or clear the filters." : "Clear the search or load more."}
          action={rows.length === 0 ? <RunDemoButton env={system.system?.env ?? null} apiState={system.api} /> : undefined}
        />
      ) : (
        <div aria-live="polite" aria-relevant="additions">
          <TableWrap className="hidden sm:block">
            <Table>
              <thead>
                <tr>
                  <Th>Created</Th>
                  <Th>Module</Th>
                  <Th>Action</Th>
                  <Th>Status</Th>
                  <Th numeric>Impact</Th>
                  <Th numeric>Expected</Th>
                  <Th>Diagnosis</Th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <Tr key={row.id} interactive className={`rail ${fresh.has(row.id) ? "row-enter" : ""}`} style={{ "--rail": moduleColorVar(row.module) } as CSSProperties} onClick={() => setSelected(row.id)}>
                    <Td className="whitespace-nowrap">
                      <time dateTime={row.created_at} suppressHydrationWarning>
                        {timeAgo(row.created_at, now)}
                      </time>
                    </Td>
                    <Td>
                      <ModuleBadge module={row.module} version={row.module_version} />
                    </Td>
                    <Td>
                      <button type="button" className="text-left hover:underline" onClick={() => setSelected(row.id)}>
                        {row.summary}
                      </button>
                      <div className="font-mono text-[11px] text-fg-muted">
                        {humanize(row.kind)} · {row.entity_id}
                      </div>
                    </Td>
                    <Td>
                      <Badge tone={statusTone(row.status)} title={row.reason ?? undefined}>
                        {humanize(row.status)}
                      </Badge>
                    </Td>
                    <Td numeric mono>
                      {row.money_impact_paise === 0 ? <span className="text-fg-muted">—</span> : formatInr(row.money_impact_paise)}
                    </Td>
                    <Td numeric mono>
                      {row.expected_recovery_paise === 0 ? <span className="text-fg-muted">—</span> : formatInr(row.expected_recovery_paise)}
                    </Td>
                    <Td>
                      {row.diagnosis_id === null ? (
                        <span className="text-xs text-fg-muted">rules only</span>
                      ) : row.diagnosis_degraded ? (
                        <Badge tone="warn">degraded</Badge>
                      ) : row.diagnosis_provider ? (
                        <span className="text-xs text-fg-muted">{row.diagnosis_provider}</span>
                      ) : (
                        <span className="text-xs text-fg-muted">live</span>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
          <ul className="flex flex-col gap-2 sm:hidden">
            {visible.map((row) => (
              <li key={row.id} className={`rail card px-4 py-3 ${fresh.has(row.id) ? "row-enter" : ""}`} style={{ "--rail": moduleColorVar(row.module) } as CSSProperties}>
                <button type="button" className="w-full text-left" onClick={() => setSelected(row.id)}>
                  <div className="flex items-center justify-between gap-2">
                    <ModuleBadge module={row.module} />
                    <Badge tone={statusTone(row.status)}>{humanize(row.status)}</Badge>
                  </div>
                  <p className="mt-1 text-sm">{row.summary}</p>
                  <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-fg-muted">
                    <span suppressHydrationWarning>{timeAgo(row.created_at, now)}</span>
                    {row.expected_recovery_paise > 0 ? <span>expects {formatInr(row.expected_recovery_paise)}</span> : null}
                    {row.diagnosis_degraded ? <span className="text-warn">degraded diagnosis</span> : null}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {next && !error ? (
        <div className="flex justify-center">
          <Button onClick={loadMore} loading={loadingMore}>
            Load older actions
          </Button>
        </div>
      ) : null}

      <ActionDrawer actionId={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
