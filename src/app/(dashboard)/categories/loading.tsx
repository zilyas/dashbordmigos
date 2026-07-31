import { Skeleton } from "@/components/ui/skeleton";

export default function CategoriesLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-7 w-32" />
          <Skeleton className="mt-2 h-4 w-48" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between rounded-xl border bg-card p-4 shadow-sm">
            <div>
              <Skeleton className="h-4 w-28" />
              <Skeleton className="mt-1.5 h-3.5 w-16" />
            </div>
            <Skeleton className="size-8 rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}
