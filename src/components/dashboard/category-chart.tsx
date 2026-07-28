"use client";

import { Cell, Pie, PieChart } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { EmptyState } from "@/components/shared/empty-state";
import { PieChart as PieChartIcon } from "lucide-react";

const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

export function CategoryChart({ data }: { data: { name: string; value: number }[] }) {
  if (data.length === 0) {
    return <EmptyState icon={<PieChartIcon />} title="No sales yet" className="h-72 border-none" />;
  }

  const chartConfig = data.reduce((acc, item, i) => {
    acc[item.name] = { label: item.name, color: COLORS[i % COLORS.length] };
    return acc;
  }, {} as ChartConfig);

  return (
    <ChartContainer config={chartConfig} className="mx-auto aspect-auto h-72 w-full">
      <PieChart>
        <ChartTooltip content={<ChartTooltipContent hideLabel />} />
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} strokeWidth={2}>
          {data.map((entry, index) => (
            <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
          ))}
        </Pie>
        <ChartLegend content={<ChartLegendContent nameKey="name" />} />
      </PieChart>
    </ChartContainer>
  );
}
