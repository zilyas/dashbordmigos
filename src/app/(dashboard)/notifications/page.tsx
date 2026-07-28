import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { getSessionContext } from "@/lib/store-context";
import { getNotificationsPage, NOTIFICATIONS_PAGE_SIZE } from "@/lib/queries/notifications";
import { NotificationHistoryList, type NotificationHistoryItem } from "@/components/notifications/notification-history-list";
import { MarkAllReadButton } from "@/components/notifications/mark-all-read-button";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  const context = await getSessionContext();
  const { notifications, total } = await getNotificationsPage(context!.userId, page);
  const totalPages = Math.max(1, Math.ceil(total / NOTIFICATIONS_PAGE_SIZE));

  const items: NotificationHistoryItem[] = notifications.map((n) => ({
    id: n.id,
    title: n.title,
    message: n.message,
    read: n.read,
    type: n.type,
    createdAt: n.createdAt.toISOString(),
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Notifications"
        description={`${total} notification${total === 1 ? "" : "s"}`}
        actions={<MarkAllReadButton />}
      />

      <NotificationHistoryList notifications={items} />

      {totalPages > 1 && (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                href={`/notifications?page=${Math.max(1, page - 1)}`}
                aria-disabled={page === 1}
                className={page === 1 ? "pointer-events-none opacity-50" : undefined}
              />
            </PaginationItem>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <PaginationItem key={p}>
                <PaginationLink href={`/notifications?page=${p}`} isActive={p === page}>
                  {p}
                </PaginationLink>
              </PaginationItem>
            ))}
            <PaginationItem>
              <PaginationNext
                href={`/notifications?page=${Math.min(totalPages, page + 1)}`}
                aria-disabled={page === totalPages}
                className={page === totalPages ? "pointer-events-none opacity-50" : undefined}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}
