import { Skeleton } from "@/components/ui/skeleton";
import { StatCardGridSkeleton, ChartSkeleton, TableSkeleton } from "@/components/shared/skeletons";

export default function ReportsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-7 w-28" />
          <Skeleton className="mt-2 h-4 w-56" />
        </div>
        <Skeleton className="h-9 w-28" />
      </div>
      <Skeleton className="h-9 w-64 rounded-lg" />
      <StatCardGridSkeleton count={4} />
      <ChartSkeleton className="h-80" />
      <TableSkeleton cols={5} />
    </div>
  );
}
