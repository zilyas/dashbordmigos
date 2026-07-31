import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
        <Sparkles className="size-4.5" />
      </div>
      <span className="text-lg font-semibold tracking-tight">Store OS</span>
    </div>
  );
}
