"use client";

import { useState, useTransition } from "react";
import { Megaphone } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDateTime } from "@/lib/format";
import { markAnnouncementRead } from "@/actions/announcements";
import type { Role } from "@/generated/prisma/enums";

export type AnnouncementItem = {
  id: string;
  title: string;
  body: string;
  scope: "PLATFORM" | "STORE";
  createdAt: string;
  readAt: string | null;
  createdBy: { name: string; role: Role };
};

export function AnnouncementList({ announcements }: { announcements: AnnouncementItem[] }) {
  const [readIds, setReadIds] = useState<Set<string>>(
    new Set(announcements.filter((a) => a.readAt).map((a) => a.id))
  );
  const [, startTransition] = useTransition();

  function handleOpen(announcement: AnnouncementItem) {
    if (readIds.has(announcement.id)) return;
    setReadIds((prev) => new Set(prev).add(announcement.id));
    startTransition(async () => {
      await markAnnouncementRead(announcement.id);
    });
  }

  if (announcements.length === 0) {
    return <EmptyState icon={<Megaphone />} title="No announcements yet" className="py-16" />;
  }

  return (
    <div className="flex flex-col gap-3">
      {announcements.map((announcement) => {
        const isUnread = !readIds.has(announcement.id);
        return (
          <Card
            key={announcement.id}
            onClick={() => handleOpen(announcement)}
            className={isUnread ? "cursor-pointer border-primary/30 bg-primary/5" : "cursor-pointer"}
          >
            <CardContent className="flex flex-col gap-2 pt-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  {isUnread && <span className="size-2 shrink-0 rounded-full bg-primary" />}
                  <h3 className="text-sm font-semibold">{announcement.title}</h3>
                </div>
                <StatusBadge variant={announcement.scope === "PLATFORM" ? "info" : "neutral"}>
                  {announcement.scope === "PLATFORM" ? "Platform" : "Store"}
                </StatusBadge>
              </div>
              <p className="text-sm whitespace-pre-wrap text-muted-foreground">{announcement.body}</p>
              <p className="text-xs text-muted-foreground">
                {announcement.createdBy.name} · {formatDateTime(announcement.createdAt)}
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
