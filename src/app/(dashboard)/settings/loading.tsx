import { Skeleton } from "@/components/ui/skeleton";

function SettingsFormSkeleton() {
  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-sm">
      <Skeleton className="h-4 w-32" />
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i}>
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="mt-1.5 h-9 w-full" />
        </div>
      ))}
      <Skeleton className="h-9 w-24" />
    </div>
  );
}

export default function SettingsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Skeleton className="h-7 w-28" />
        <Skeleton className="mt-2 h-4 w-56" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SettingsFormSkeleton />
        <SettingsFormSkeleton />
      </div>
    </div>
  );
}
