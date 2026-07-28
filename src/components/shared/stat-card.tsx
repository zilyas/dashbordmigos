"use client";

import { motion } from "framer-motion";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  icon,
  trend,
  tint = "primary",
  className,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  trend?: { value: number; label?: string };
  tint?: "primary" | "success" | "warning" | "destructive";
  className?: string;
}) {
  const tintClasses: Record<string, string> = {
    primary: "bg-primary/10 text-primary",
    success: "bg-success/10 text-success",
    warning: "bg-warning/15 text-warning-foreground",
    destructive: "bg-destructive/10 text-destructive",
  };

  const isPositive = (trend?.value ?? 0) >= 0;

  return (
    <motion.div
      whileHover={{ y: -2 }}
      transition={{ duration: 0.15 }}
      className={cn(
        "flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm",
        className
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className={cn("flex size-8 items-center justify-center rounded-lg [&_svg]:size-4", tintClasses[tint])}>
          {icon}
        </span>
      </div>
      <div className="flex items-end justify-between gap-2">
        <span className="text-2xl font-semibold tracking-tight tabular-nums">{value}</span>
        {trend && (
          <span
            className={cn(
              "mb-0.5 flex items-center gap-0.5 text-xs font-medium",
              isPositive ? "text-success" : "text-destructive"
            )}
          >
            {isPositive ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
            {Math.abs(trend.value).toFixed(1)}%
          </span>
        )}
      </div>
      {trend?.label && <span className="text-xs text-muted-foreground">{trend.label}</span>}
    </motion.div>
  );
}
