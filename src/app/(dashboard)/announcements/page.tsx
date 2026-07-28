import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { getSessionContext } from "@/lib/store-context";
import { can } from "@/lib/rbac";
import { getAnnouncementsForUser } from "@/lib/queries/announcements";
import { AnnouncementList, type AnnouncementItem } from "@/components/announcements/announcement-list";
import { CreateAnnouncementDialog } from "@/components/announcements/create-announcement-dialog";

export const metadata: Metadata = { title: "Announcements" };

export default async function AnnouncementsPage() {
  const context = await getSessionContext();
  const rows = await getAnnouncementsForUser(context!.userId);

  const announcements: AnnouncementItem[] = rows.map((r) => ({
    id: r.announcement.id,
    title: r.announcement.title,
    body: r.announcement.body,
    scope: r.announcement.scope,
    createdAt: r.announcement.createdAt.toISOString(),
    readAt: r.readAt ? r.readAt.toISOString() : null,
    createdBy: { name: r.announcement.createdBy.name, role: r.announcement.createdBy.role },
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Announcements"
        description="Updates from your platform and store leadership."
        actions={can(context!.role, "announcement.manage") ? <CreateAnnouncementDialog role={context!.role} /> : undefined}
      />
      <AnnouncementList announcements={announcements} />
    </div>
  );
}
