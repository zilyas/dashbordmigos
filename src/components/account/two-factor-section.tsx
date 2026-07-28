"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, ShieldCheck, ShieldOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  cancelTwoFactorEnrollment,
  confirmTwoFactorEnrollment,
  disableTwoFactor,
  regenerateRecoveryCodes,
  startTwoFactorEnrollment,
} from "@/actions/two-factor";

type Step = "idle" | "enrolling" | "recovery-codes";

export function TwoFactorSection({ initiallyEnabled }: { initiallyEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initiallyEnabled);
  const [step, setStep] = useState<Step>("idle");
  const [isPending, startTransition] = useTransition();
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [disablePassword, setDisablePassword] = useState("");
  const [disableError, setDisableError] = useState<string | null>(null);
  const [regenPassword, setRegenPassword] = useState("");
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);

  function handleStartEnrollment() {
    startTransition(async () => {
      const result = await startTwoFactorEnrollment();
      if (result.error || !result.secret || !result.qrCodeDataUrl) {
        toast.error(result.error ?? "Failed to start enrollment.");
        return;
      }
      setSecret(result.secret);
      setQrCodeDataUrl(result.qrCodeDataUrl);
      setCode("");
      setStep("enrolling");
    });
  }

  function handleCancelEnrollment() {
    startTransition(async () => {
      await cancelTwoFactorEnrollment();
      setStep("idle");
      setSecret(null);
      setQrCodeDataUrl(null);
    });
  }

  function handleConfirm() {
    startTransition(async () => {
      const result = await confirmTwoFactorEnrollment(code);
      if (result.error || !result.recoveryCodes) {
        toast.error(result.error ?? "Failed to verify code.");
        return;
      }
      setRecoveryCodes(result.recoveryCodes);
      setStep("recovery-codes");
      setEnabled(true);
    });
  }

  function handleDisable() {
    setDisableError(null);
    startTransition(async () => {
      const result = await disableTwoFactor(disablePassword);
      if (result.error) {
        setDisableError(result.error);
        return;
      }
      setEnabled(false);
      setDisablePassword("");
      toast.success("Two-factor authentication disabled");
    });
  }

  function handleRegenerate() {
    setRegenError(null);
    startTransition(async () => {
      const result = await regenerateRecoveryCodes(regenPassword);
      if (result.error || !result.recoveryCodes) {
        setRegenError(result.error ?? "Failed to regenerate codes.");
        return;
      }
      setRegenPassword("");
      setRegenOpen(false);
      setRecoveryCodes(result.recoveryCodes);
      setStep("recovery-codes");
    });
  }

  function finishRecoveryCodesStep() {
    setStep("idle");
    setRecoveryCodes([]);
  }

  return (
    <>
      <Card>
        <CardHeader className="flex-row items-center justify-between border-b pb-4">
          <div>
            <CardTitle>Two-factor authentication</CardTitle>
            <CardDescription>
              Require a verification code from an authenticator app when signing in.
            </CardDescription>
          </div>
          <StatusBadge variant={enabled ? "success" : "neutral"}>
            {enabled ? "Enabled" : "Disabled"}
          </StatusBadge>
        </CardHeader>
        <CardContent className="pt-4">
          {step === "idle" && !enabled && (
            <Button onClick={handleStartEnrollment} disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" />}
              <ShieldCheck className="size-4" />
              Enable two-factor authentication
            </Button>
          )}

          {step === "idle" && enabled && (
            <div className="flex flex-wrap gap-2">
              <Dialog open={regenOpen} onOpenChange={setRegenOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline">View new recovery codes</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Regenerate recovery codes</DialogTitle>
                    <DialogDescription>
                      This invalidates your existing recovery codes. Confirm your password to continue.
                    </DialogDescription>
                  </DialogHeader>
                  <Input
                    type="password"
                    placeholder="Password"
                    value={regenPassword}
                    onChange={(e) => setRegenPassword(e.target.value)}
                  />
                  {regenError && <p className="text-sm text-destructive">{regenError}</p>}
                  <DialogFooter>
                    <Button onClick={handleRegenerate} disabled={isPending || !regenPassword}>
                      {isPending && <Loader2 className="size-4 animate-spin" />}
                      Regenerate codes
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" className="text-destructive hover:text-destructive">
                    <ShieldOff className="size-4" />
                    Disable
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Disable two-factor authentication?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Your account will only be protected by your password. Confirm your password to
                      continue.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <Input
                    type="password"
                    placeholder="Password"
                    value={disablePassword}
                    onChange={(e) => setDisablePassword(e.target.value)}
                  />
                  {disableError && <p className="text-sm text-destructive">{disableError}</p>}
                  <AlertDialogFooter>
                    <AlertDialogCancel
                      onClick={() => {
                        setDisablePassword("");
                        setDisableError(null);
                      }}
                    >
                      Cancel
                    </AlertDialogCancel>
                    <Button
                      variant="destructive"
                      onClick={handleDisable}
                      disabled={isPending || !disablePassword}
                    >
                      {isPending && <Loader2 className="size-4 animate-spin" />}
                      Disable
                    </Button>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}

          {step === "enrolling" && (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">
                Scan this QR code with your authenticator app (Google Authenticator, 1Password,
                Authy...), then enter the 6-digit code it generates.
              </p>
              {qrCodeDataUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qrCodeDataUrl}
                  alt="Two-factor authentication QR code"
                  className="size-40 rounded-lg border p-2"
                />
              )}
              {secret && (
                <p className="text-xs text-muted-foreground">
                  Can&apos;t scan it? Enter this code manually:{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{secret}</code>
                </p>
              )}
              <InputOTP maxLength={6} value={code} onChange={setCode}>
                <InputOTPGroup>
                  <InputOTPSlot index={0} />
                  <InputOTPSlot index={1} />
                  <InputOTPSlot index={2} />
                  <InputOTPSlot index={3} />
                  <InputOTPSlot index={4} />
                  <InputOTPSlot index={5} />
                </InputOTPGroup>
              </InputOTP>
              <div className="flex gap-2">
                <Button onClick={handleConfirm} disabled={isPending || code.length !== 6}>
                  {isPending && <Loader2 className="size-4 animate-spin" />}
                  Verify and enable
                </Button>
                <Button variant="ghost" onClick={handleCancelEnrollment} disabled={isPending}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={step === "recovery-codes"} onOpenChange={(open) => !open && finishRecoveryCodesStep()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save your recovery codes</DialogTitle>
            <DialogDescription>
              Each code can be used once to sign in if you lose access to your authenticator app. Store
              them somewhere safe — they won&apos;t be shown again.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/40 p-3 font-mono text-sm">
            {recoveryCodes.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
          <DialogFooter>
            <Button onClick={finishRecoveryCodesStep}>I&apos;ve saved these codes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
