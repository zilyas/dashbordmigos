import { Skeleton } from "@/components/ui/skeleton";

export default function MessagesLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Skeleton className="h-7 w-28" />
        <Skeleton className="mt-2 h-4 w-48" />
      </div>
      <div className="flex h-[calc(100dvh-10rem)] overflow-hidden rounded-xl border bg-card">
        <div className="flex w-full shrink-0 flex-col gap-3 border-r p-3 md:w-80 md:max-w-xs">
          <Skeleton className="h-9 w-full" />
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="size-9 shrink-0 rounded-full" />
              <div className="flex-1">
                <Skeleton className="h-3.5 w-2/3" />
                <Skeleton className="mt-1.5 h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
        <div className="hidden flex-1 items-center justify-center md:flex">
          <Skeleton className="size-12 rounded-full" />
        </div>
      </div>
    </div>
  );
}
