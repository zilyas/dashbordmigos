import { formatDistanceToNow } from "date-fns";
import { Package, ShoppingCart, UserPlus, Store, Activity as ActivityIcon, type LucideIcon } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { describeActivity } from "@/lib/activity-format";

export type ActivityLogItem = {
  id: string;
  action: string;
  entity: string;
  userName: string;
  storeName?: string | null;
  createdAt: string;
  metadata: Record<string, unknown> | null;
};

const ACTION_ICON: Record<string, LucideIcon> = {
  "product.created": Package,
  "product.updated": Package,
  "sale.created": ShoppingCart,
  "user.created": UserPlus,
  "manager.created": UserPlus,
  "manager.transferred": UserPlus,
  "store.created": Store,
};

export function ActivityFeed({ items }: { items: ActivityLogItem[] }) {
  if (items.length === 0) {
    return <EmptyState icon={<ActivityIcon />} title="No activity yet" className="h-72 border-none" />;
  }

  return (
    <div className="flex flex-col">
      {items.map((item, i) => {
        const Icon = ACTION_ICON[item.action] ?? ActivityIcon;
        return (
          <div key={item.id} className="relative flex gap-3 pb-5 last:pb-0">
            {i < items.length - 1 && (
              <span className="absolute top-7 left-3.5 h-full w-px bg-border" />
            )}
            <span className="z-10 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
              <Icon className="size-3.5 text-muted-foreground" />
            </span>
            <div className="flex flex-col gap-0.5 pt-0.5">
              <p className="text-sm">
                <span className="font-medium">{item.userName}</span>{" "}
                <span className="text-muted-foreground">
                  {describeActivity(item.action, item.entity, item.metadata)}
                </span>
              </p>
              <span className="text-xs text-muted-foreground/70">
                {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                {item.storeName ? ` · ${item.storeName}` : ""}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
