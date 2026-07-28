import Link from "next/link";
import { ArrowRight, Megaphone } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDateTime } from "@/lib/format";

export type UnreadAnnouncementItem = {
  id: string;
  title: string;
  scope: "PLATFORM" | "STORE";
  createdAt: Date;
  createdBy: { name: string };
};

export function UnreadAnnouncementsCard({ announcements }: { announcements: UnreadAnnouncementItem[] }) {
  if (announcements.length === 0) return null;

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="flex-row items-center justify-between border-b pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <Megaphone className="size-4 text-primary" />
          {announcements.length} unread announcement{announcements.length === 1 ? "" : "s"}
        </CardTitle>
        <Link
          href="/announcements"
          className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          View all
          <ArrowRight className="size-3" />
        </Link>
      </CardHeader>
      <CardContent className="flex flex-col divide-y pt-4">
        {announcements.map((announcement) => (
          <Link
            key={announcement.id}
            href="/announcements"
            className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
          >
            <div>
              <p className="text-sm font-medium">{announcement.title}</p>
              <p className="text-xs text-muted-foreground">
                {announcement.createdBy.name} · {formatDateTime(announcement.createdAt)}
              </p>
            </div>
            <StatusBadge variant={announcement.scope === "PLATFORM" ? "info" : "neutral"}>
              {announcement.scope === "PLATFORM" ? "Platform" : "Store"}
            </StatusBadge>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
