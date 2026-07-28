import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { readBackupFile } from "@/lib/storage/backups";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !can(session.user.role, "backup.manage")) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { id } = await params;
  const record = await prisma.backupRecord.findUnique({ where: { id } });
  if (!record || record.status !== "COMPLETED") {
    return NextResponse.json({ error: "Backup not found" }, { status: 404 });
  }

  try {
    const content = await readBackupFile(record.filename);
    return new NextResponse(content, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${record.filename}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "Backup file is missing on disk" }, { status: 404 });
  }
}
