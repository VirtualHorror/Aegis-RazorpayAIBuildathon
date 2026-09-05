"use client";

import { useEffect, useState } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { api, describeFailure } from "@/lib/api";
import type { ActionDetail } from "@/lib/types";
import { ActionDetailView } from "./ActionDetailView";

export function ActionDrawer({ actionId, onClose }: { actionId: string | null; onClose: () => void }) {
  return (
    <Drawer
      open={actionId !== null}
      onClose={onClose}
      title="Action"
      description={actionId ? <span className="font-mono">{actionId}</span> : undefined}
      width="max-w-3xl"
      footer={actionId ? <ButtonLink href={`/actions/${actionId}`} size="sm">Open full page</ButtonLink> : undefined}
    >
      {actionId ? <ActionDetailLoader key={actionId} actionId={actionId} /> : null}
    </Drawer>
  );
}

function ActionDetailLoader({ actionId }: { actionId: string }) {
  const [detail, setDetail] = useState<ActionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void api.action(actionId).then((result) => {
      if (!alive) return;
      if (result.ok) setDetail(result.data);
      else setError(describeFailure(result));
    });
    return () => {
      alive = false;
    };
  }, [actionId]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!detail) return <SkeletonRows rows={8} />;
  return <ActionDetailView detail={detail} compact />;
}
