import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { logActivity } from "@/lib/audit";
import { getReportData, REPORT_PERIODS, type ReportPeriod } from "@/lib/queries/reports";
import { getStoreSettings } from "@/lib/queries/settings";
import { DEFAULT_CURRENCY } from "@/lib/format";

function csvEscape(value: string | number) {
  const str = String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user || !can(session.user.role, "report.export")) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const periodParam = searchParams.get("period") ?? "monthly";
  const period = (REPORT_PERIODS as readonly string[]).includes(periodParam)
    ? (periodParam as ReportPeriod)
    : "monthly";

  const storeId = session.user.role === "SUPER_ADMIN" ? null : session.user.storeId;
  const [data, settings] = await Promise.all([
    getReportData(period, storeId),
    storeId ? getStoreSettings(storeId) : Promise.resolve(null),
  ]);
  const currency = settings?.currency ?? DEFAULT_CURRENCY;

  await logActivity({
    storeId,
    userId: session.user.id,
    action: "report.exported",
    entity: "Report",
    metadata: { period },
  });

  const rows = [
    ["Currency", currency],
    [],
    ["Period", "Revenue", "Profit", "Orders"],
    ...data.breakdown.map((b) => [b.label, b.revenue, b.profit, b.orders]),
    [],
    ["Total", data.summary.revenue, data.summary.profit, data.summary.orders],
  ];

  const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="report-${period}-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
