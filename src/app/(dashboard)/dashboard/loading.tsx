import { StatCardGridSkeleton, ChartSkeleton } from "@/components/shared/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-7 w-40" />
          <Skeleton className="mt-2 h-4 w-56" />
        </div>
        <Skeleton className="h-9 w-24" />
      </div>
      <StatCardGridSkeleton count={9} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ChartSkeleton className="h-80 lg:col-span-2" />
        <ChartSkeleton className="h-80" />
      </div>
    </div>
  );
}
