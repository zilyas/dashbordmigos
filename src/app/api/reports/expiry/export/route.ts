import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { logActivity } from "@/lib/audit";
import { csvEscape } from "@/lib/csv";
import { getExpiryReport, parseExpiryFilter } from "@/lib/queries/expiry-reports";
import { BUCKET_LABEL } from "@/lib/expiry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Store-scoped expiry CSV export. The store is derived from the session
 * (a Manager's own store) — never from a query parameter. Reuses the same report
 * query (so classification/filter/timezone rules can't drift from the UI) and
 * `csvEscape` (so formula-injection protection is preserved).
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user || !can(session.user.role, "report.view")) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  // Expiry reporting is per-store; only a store-scoped Manager may export.
  const storeId = session.user.role === "SUPER_ADMIN" ? null : session.user.storeId;
  if (!storeId) {
    return NextResponse.json({ error: "No store scope for expiry export." }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const filter = parseExpiryFilter(searchParams.get("window") ?? undefined);
  const report = await getExpiryReport(storeId, filter);

  await logActivity({
    storeId,
    userId: session.user.id,
    action: "report.expiryExported",
    entity: "Report",
    metadata: { filter, rows: report.rows.length },
  });

  const header = [
    "Product",
    "SKU",
    "Variant",
    "Batch code",
    "Quantity",
    "Unit",
    "Expiry date",
    "Days remaining",
    "Bucket",
    "Effective unit cost",
    "Stock value",
    "Status",
  ];
  const rows = report.rows.map((r) => [
    r.productName,
    r.productSku,
    r.variantLabel ?? "",
    r.batchCode,
    r.quantity,
    r.unit,
    r.expiryDate ?? "",
    r.daysUntilExpiry ?? "",
    BUCKET_LABEL[r.bucket],
    r.effectiveUnitCost,
    r.stockValue,
    r.status,
  ]);

  const csv = [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="expiry-${filter}-${report.storeToday}.csv"`,
    },
  });
}
