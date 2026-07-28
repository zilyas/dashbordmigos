"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
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
      toast.success("Backup created");
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
      toast.success("Restore complete. You may need to sign in again.");
      setPendingFile(null);
      setConfirmText("");
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex-row items-center justify-between border-b pb-4">
          <div>
            <CardTitle>Create a backup</CardTitle>
            <CardDescription>
              Exports every table to a downloadable JSON file. Contains sensitive data — store it
              securely.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 pt-4">
          <Button onClick={handleCreate} disabled={isCreating}>
            {isCreating && <Loader2 className="size-4 animate-spin" />}
            <DatabaseBackup className="size-4" />
            Create backup
          </Button>
          <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
            <Upload className="size-4" />
            Restore from file
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
          <CardTitle>Backup history</CardTitle>
          <CardDescription>Every backup created on this platform.</CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          {records.length === 0 ? (
            <EmptyState icon={<DatabaseBackup />} title="No backups yet" className="border-none py-10" />
          ) : (
            <div className="flex flex-col divide-y">
              {records.map((record) => (
                <div key={record.id} className="flex items-center justify-between gap-4 py-3">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {record.filename}
                      <StatusBadge variant={record.status === "COMPLETED" ? "success" : "destructive"}>
                        {record.status === "COMPLETED" ? "Completed" : "Failed"}
                      </StatusBadge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatBytes(record.sizeBytes)} · by {record.createdBy.name} ·{" "}
                      {formatDateTime(record.createdAt)}
                    </p>
                  </div>
                  {record.status === "COMPLETED" && (
                    <Button variant="ghost" size="sm" asChild>
                      <a href={`/api/backups/${record.id}/download`} download>
                        <Download className="size-4" />
                        Download
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
            <AlertDialogTitle>Restore from &quot;{pendingFile?.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently replaces every store, product, sale, user and setting on the entire
              platform with the contents of this file. This cannot be undone. Type{" "}
              <strong>{RESTORE_CONFIRMATION_TEXT}</strong> to confirm.
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
              Cancel
            </AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={handleRestore}
              disabled={isRestoring || confirmText !== RESTORE_CONFIRMATION_TEXT}
            >
              {isRestoring && <Loader2 className="size-4 animate-spin" />}
              Restore and replace everything
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
