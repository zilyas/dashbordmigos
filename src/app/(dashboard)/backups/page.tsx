import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { BackupsManager, type BackupRow } from "@/components/backups/backups-manager";
import { getBackupHistory } from "@/lib/queries/backups";

export const metadata: Metadata = { title: "Backups" };

export default async function BackupsPage() {
  const records = await getBackupHistory();

  const rows: BackupRow[] = records.map((r) => ({
    id: r.id,
    filename: r.filename,
    sizeBytes: r.sizeBytes,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    createdBy: { name: r.createdBy.name, email: r.createdBy.email },
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Backups" description="Create, download and restore full platform backups." />
      <BackupsManager records={rows} />
    </div>
  );
}
