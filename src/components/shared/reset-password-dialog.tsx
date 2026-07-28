"use client";

import { useState } from "react";
import { Check, Copy, KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function ResetPasswordDialog({
  open,
  onOpenChange,
  userName,
  onReset,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userName: string;
  onReset: () => Promise<{ error?: string; tempPassword?: string }>;
}) {
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleReset() {
    setIsPending(true);
    try {
      const result = await onReset();
      if (result.error || !result.tempPassword) {
        toast.error(result.error ?? "Failed to reset password.");
        return;
      }
      setTempPassword(result.tempPassword);
    } finally {
      setIsPending(false);
    }
  }

  function handleClose(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setTimeout(() => {
        setTempPassword(null);
        setCopied(false);
      }, 200);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset password</DialogTitle>
          <DialogDescription>
            {tempPassword
              ? `Share this temporary password with ${userName} securely. It won't be shown again.`
              : `Generate a new temporary password for ${userName}.`}
          </DialogDescription>
        </DialogHeader>

        {tempPassword ? (
          <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2.5">
            <KeyRound className="size-4 shrink-0 text-muted-foreground" />
            <code className="flex-1 font-mono text-sm">{tempPassword}</code>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => {
                navigator.clipboard.writeText(tempPassword);
                setCopied(true);
                toast.success("Copied to clipboard");
              }}
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </Button>
          </div>
        ) : null}

        <DialogFooter className="mt-2">
          {tempPassword ? (
            <Button onClick={() => handleClose(false)}>Done</Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => handleClose(false)}>
                Cancel
              </Button>
              <Button onClick={handleReset} disabled={isPending}>
                {isPending && <Loader2 className="size-4 animate-spin" />}
                Generate password
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
