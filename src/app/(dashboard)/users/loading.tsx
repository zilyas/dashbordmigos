import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/components/shared/skeletons";

export default function UsersLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-7 w-24" />
          <Skeleton className="mt-2 h-4 w-48" />
        </div>
        <Skeleton className="h-9 w-28" />
      </div>
      <TableSkeleton cols={5} />
    </div>
  );
}
