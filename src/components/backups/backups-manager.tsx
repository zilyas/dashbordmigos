"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { DatabaseBackup, Download, Loader2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatDateTime } from "@/lib/format";
import { createBackup, restoreBackup } from "@/actions/backup";

const RESTORE_CONFIRMATION_TEXT = "RESTORE";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type BackupRow = {
  id: string;
  filename: string;
  sizeBytes: number;
  status: "COMPLETED" | "FAILED";
  createdAt: string;
  createdBy: { name: string; email: string };
};

export function BackupsManager({ records }: { records: BackupRow[] }) {
  const t = useTranslations("backups");
  const [isCreating, startCreate] = useTransition();
  const [isRestoring, startRestore] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<{ name: string; content: string } | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [restoreError, setRestoreError] = useState<string | null>(null);

  function handleCreate() {
    startCreate(async () => {
      const result = await createBackup();
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success(t("create.toastCreated"));
    });
  }

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then((content) => {
      setPendingFile({ name: file.name, content });
      setConfirmText("");
      setRestoreError(null);
    });
    e.target.value = "";
  }

  function handleRestore() {
    if (!pendingFile) return;
    setRestoreError(null);
    startRestore(async () => {
      const result = await restoreBackup(pendingFile.content, confirmText);
      if (result?.error) {
        setRestoreError(result.error);
        return;
      }
      toast.success(t("restoreDialog.toastRestored"));
      setPendingFile(null);
      setConfirmText("");
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="border-b pb-4">
          <CardTitle>{t("create.title")}</CardTitle>
          <CardDescription>
            {t("create.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 pt-4">
          <Button onClick={handleCreate} disabled={isCreating}>
            {isCreating && <Loader2 className="size-4 animate-spin" />}
            <DatabaseBackup className="size-4" />
            {t("create.createButton")}
          </Button>
          <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
            <Upload className="size-4" />
            {t("create.restoreFromFileButton")}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={handleFileSelected}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b pb-4">
          <CardTitle>{t("history.title")}</CardTitle>
          <CardDescription>{t("history.description")}</CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          {records.length === 0 ? (
            <EmptyState icon={<DatabaseBackup />} title={t("history.emptyTitle")} className="border-none py-10" />
          ) : (
            <div className="flex flex-col divide-y">
              {records.map((record) => (
                <div key={record.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <span className="truncate">{record.filename}</span>
                      <StatusBadge
                        variant={record.status === "COMPLETED" ? "success" : "destructive"}
                        className="shrink-0"
                      >
                        {record.status === "COMPLETED" ? t("history.completed") : t("history.failed")}
                      </StatusBadge>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {t("history.byLine", {
                        size: formatBytes(record.sizeBytes),
                        name: record.createdBy.name,
                        date: formatDateTime(record.createdAt),
                      })}
                    </p>
                  </div>
                  {record.status === "COMPLETED" && (
                    <Button variant="ghost" size="sm" className="shrink-0" asChild>
                      <a href={`/api/backups/${record.id}/download`} download>
                        <Download className="size-4" />
                        <span className="hidden sm:inline">{t("history.download")}</span>
                      </a>
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!pendingFile} onOpenChange={(open) => !open && setPendingFile(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("restoreDialog.title", { filename: pendingFile?.name ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.rich("restoreDialog.description", {
                confirmText: RESTORE_CONFIRMATION_TEXT,
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={RESTORE_CONFIRMATION_TEXT}
            autoFocus
          />
          {restoreError && <p className="text-sm text-destructive">{restoreError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRestoring} onClick={() => setPendingFile(null)}>
              {t("restoreDialog.cancel")}
            </AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={handleRestore}
              disabled={isRestoring || confirmText !== RESTORE_CONFIRMATION_TEXT}
            >
              {isRestoring && <Loader2 className="size-4 animate-spin" />}
              {t("restoreDialog.confirmButton")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
