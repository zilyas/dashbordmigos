"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { DEFAULT_CURRENCY, formatCurrency, formatNumber } from "@/lib/format";

const chartConfig = {
  revenue: { label: "Revenue", color: "var(--chart-1)" },
  profit: { label: "Profit", color: "var(--chart-2)" },
} satisfies ChartConfig;

export function RevenueChart({
  data,
  currency = DEFAULT_CURRENCY,
}: {
  data: { date: string; revenue: number; profit: number }[];
  currency?: string;
}) {
  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-72 w-full">
      <AreaChart data={data} margin={{ left: 0, right: 12, top: 12 }}>
        <defs>
          <linearGradient id="fillRevenue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-revenue)" stopOpacity={0.35} />
            <stop offset="95%" stopColor="var(--color-revenue)" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="fillProfit" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-profit)" stopOpacity={0.35} />
            <stop offset="95%" stopColor="var(--color-profit)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          interval="preserveStartEnd"
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          width={40}
          tickFormatter={(value: number) => formatNumber(value)}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              indicator="dot"
              formatter={(value, name) => (
                <span className="flex w-full items-center justify-between gap-4">
                  <span className="text-muted-foreground capitalize">{name}</span>
                  <span className="font-mono font-medium tabular-nums">
                    {formatCurrency(value as number, currency)}
                  </span>
                </span>
              )}
            />
          }
        />
        <Area
          dataKey="revenue"
          type="monotone"
          stroke="var(--color-revenue)"
          fill="url(#fillRevenue)"
          strokeWidth={2}
        />
        <Area
          dataKey="profit"
          type="monotone"
          stroke="var(--color-profit)"
          fill="url(#fillProfit)"
          strokeWidth={2}
        />
      </AreaChart>
    </ChartContainer>
  );
}
