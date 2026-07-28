import { cn } from "@/lib/utils";

const VARIANT_CLASSES = {
  success: "bg-success/10 text-success",
  warning: "bg-warning/15 text-warning-foreground",
  destructive: "bg-destructive/10 text-destructive",
  info: "bg-primary/10 text-primary",
  neutral: "bg-muted text-muted-foreground",
} as const;

export type StatusBadgeVariant = keyof typeof VARIANT_CLASSES;

export function StatusBadge({
  children,
  variant = "neutral",
  className,
}: {
  children: React.ReactNode;
  variant?: StatusBadgeVariant;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        VARIANT_CLASSES[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
