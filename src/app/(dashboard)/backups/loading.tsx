import { Skeleton } from "@/components/ui/skeleton";

export default function BackupsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Skeleton className="h-7 w-24" />
        <Skeleton className="mt-2 h-4 w-56" />
      </div>
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <Skeleton className="h-4 w-32" />
        <div className="mt-4 flex gap-2">
          <Skeleton className="h-9 w-36" />
          <Skeleton className="h-9 w-40" />
        </div>
      </div>
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <Skeleton className="h-4 w-32" />
        <div className="mt-4 flex flex-col divide-y">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between py-3">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
