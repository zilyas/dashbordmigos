"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { EmptyState } from "@/components/shared/empty-state";
import { BarChart3 } from "lucide-react";

const chartConfig = {
  quantity: { label: "Units sold", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function BestSellersChart({ data }: { data: { name: string; quantity: number }[] }) {
  if (data.length === 0) {
    return <EmptyState icon={<BarChart3 />} title="No sales yet" className="h-72 border-none" />;
  }

  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-72 w-full">
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
        <XAxis type="number" tickLine={false} axisLine={false} />
        <YAxis
          type="category"
          dataKey="name"
          tickLine={false}
          axisLine={false}
          width={120}
          tick={{ fontSize: 12 }}
        />
        <ChartTooltip content={<ChartTooltipContent hideLabel />} />
        <Bar dataKey="quantity" fill="var(--color-quantity)" radius={[0, 6, 6, 0]} />
      </BarChart>
    </ChartContainer>
  );
}
