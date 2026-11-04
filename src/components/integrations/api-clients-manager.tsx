"use client";

import { useMemo, useState, useTransition } from "react";
import { useForm, useWatch, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { Plus, KeyRound, Copy, Ban, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { createApiClient, revokeApiClient } from "@/actions/api-clients";
import { buildApiClientSchema, type ApiClientInput } from "@/lib/validations/api-client";
import { API_SCOPES, type ApiScope } from "@/lib/api/scopes";
import { formatDateTime } from "@/lib/format";
import type { ApiClientItem } from "@/lib/queries/api-clients";

const EXPIRY_CHOICES = [30, 90, 180, 365];

const SCOPE_I18N_KEYS: Record<ApiScope, string> = {
  "products:read": "productsRead",
  "stock:read": "stockRead",
  "orders:create": "ordersCreate",
};

export function ApiClientsManager({ clients }: { clients: ApiClientItem[] }) {
  const t = useTranslations("integrations.manager");
  const tScopes = useTranslations("integrations.scopes");
  const [dialogOpen, setDialogOpen] = useState(false);
  // Bumped on every open so the dialog remounts: the minted key lives in that
  // child's state and must not survive a close.
  const [dialogRun, setDialogRun] = useState(0);
  const [revokeTarget, setRevokeTarget] = useState<ApiClientItem | null>(null);

  function openCreate() {
    setDialogRun((n) => n + 1);
    setDialogOpen(true);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-end">
        <Button onClick={openCreate} className="gap-1.5">
          <Plus className="size-4" />
          {t("newKey")}
        </Button>
      </div>

      {clients.length === 0 ? (
        <EmptyState
          icon={<KeyRound />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={
            <Button onClick={openCreate} size="sm">
              {t("newKey")}
            </Button>
          }
        />
      ) : (
        <div className="rounded-xl border bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("table.name")}</TableHead>
                <TableHead>{t("table.key")}</TableHead>
                <TableHead>{t("table.permissions")}</TableHead>
                <TableHead>{t("table.status")}</TableHead>
                <TableHead>{t("table.expires")}</TableHead>
                <TableHead>{t("table.lastUsed")}</TableHead>
                <TableHead>{t("table.madeBy")}</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.map((client) => (
                <TableRow key={client.id}>
                  <TableCell className="font-medium">{client.name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    sk_{client.keyPrefix}_&hellip;
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {client.scopes.map((scope) => {
                        const i18nKey = SCOPE_I18N_KEYS[scope as ApiScope];
                        return (
                          <StatusBadge key={scope} variant="neutral">
                            {i18nKey ? tScopes(i18nKey) : scope}
                          </StatusBadge>
                        );
                      })}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge variant={client.status === "ACTIVE" ? "success" : "destructive"}>
                      {client.status === "ACTIVE" ? t("active") : t("revoked")}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {client.expiresAt ? formatDateTime(client.expiresAt) : t("never")}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {client.lastUsedAt ? formatDateTime(client.lastUsedAt) : t("never")}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {client.actor?.name ?? t("unknown")}
                  </TableCell>
                  <TableCell>
                    {client.status === "ACTIVE" && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setRevokeTarget(client)}
                      >
                        <Ban className="size-3.5" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <NewKeyDialog key={dialogRun} open={dialogOpen} onOpenChange={setDialogOpen} />

      {revokeTarget && (
        <ConfirmDialog
          open={!!revokeTarget}
          onOpenChange={(open) => !open && setRevokeTarget(null)}
          title={t("revokeDialog.title", { name: revokeTarget.name })}
          description={t("revokeDialog.description")}
          confirmLabel={t("revokeDialog.confirm")}
          destructive
          onConfirm={async () => {
            const result = await revokeApiClient(revokeTarget.id);
            if ("error" in result) toast.error(result.error);
            else toast.success(t("revokeDialog.toastRevoked"));
          }}
        />
      )}
    </div>
  );
}

function NewKeyDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [minted, setMinted] = useState<string | null>(null);
  const t = useTranslations("integrations.newKeyDialog");
  const tScopes = useTranslations("integrations.scopes");
  const tValidation = useTranslations("validation");
  const apiClientSchema = useMemo(() => buildApiClientSchema(tValidation), [tValidation]);

  const form = useForm<ApiClientInput>({
    resolver: zodResolver(apiClientSchema),
    defaultValues: { name: "", scopes: [], expiresInDays: 365 },
  });
  // `form.watch` is rejected by the react-hooks/incompatible-library rule.
  const scopes = useWatch({ control: form.control, name: "scopes" }) ?? [];

  function toggleScope(scope: ApiScope, checked: boolean) {
    const next = checked ? [...scopes, scope] : scopes.filter((s) => s !== scope);
    form.setValue("scopes", next, { shouldValidate: form.formState.isSubmitted });
  }

  function onSubmit(values: ApiClientInput) {
    startTransition(async () => {
      const result = await createApiClient(values);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setMinted(result.key);
    });
  }

  async function copyKey(key: string) {
    try {
      await navigator.clipboard.writeText(key);
      toast.success(t("toastCopied"));
    } catch {
      toast.error(t("toastCopyFailed"));
    }
  }

  function dismissMinted() {
    setMinted(null);
    onOpenChange(false);
    form.reset();
  }

  if (minted) {
    return (
      // No `onOpenChange` and no close button: Escape or a click outside would
      // destroy a key that cannot be read again.
      <Dialog open={open}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t("minted.title")}</DialogTitle>
            <DialogDescription>
              {t("minted.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg bg-muted p-3 font-mono text-xs break-all">{minted}</div>
          <DialogFooter className="mt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => copyKey(minted)}
              className="gap-1.5"
            >
              <Copy className="size-4" />
              {t("minted.copyButton")}
            </Button>
            <Button type="button" onClick={dismissMinted}>
              {t("minted.doneButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {t("description")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            <Field data-invalid={!!form.formState.errors.name}>
              <FieldLabel htmlFor="api-client-name">{t("nameLabel")}</FieldLabel>
              <Input id="api-client-name" placeholder={t("namePlaceholder")} {...form.register("name")} />
              {form.formState.errors.name && (
                <FieldError>{form.formState.errors.name.message}</FieldError>
              )}
            </Field>

            <Field data-invalid={!!form.formState.errors.scopes}>
              <FieldLabel>{t("permissionsLabel")}</FieldLabel>
              <div className="flex flex-col gap-2.5">
                {API_SCOPES.map((scope) => (
                  <div key={scope} className="flex items-center gap-2">
                    <Checkbox
                      id={`scope-${scope}`}
                      checked={scopes.includes(scope)}
                      onCheckedChange={(checked) => toggleScope(scope, checked === true)}
                    />
                    <label htmlFor={`scope-${scope}`} className="text-sm">
                      {tScopes(SCOPE_I18N_KEYS[scope])}
                    </label>
                  </div>
                ))}
              </div>
              {form.formState.errors.scopes && (
                <FieldError>{form.formState.errors.scopes.message}</FieldError>
              )}
            </Field>

            <Field>
              <FieldLabel>{t("expiresAfterLabel")}</FieldLabel>
              <Controller
                control={form.control}
                name="expiresInDays"
                render={({ field }) => (
                  <Select
                    value={String(field.value)}
                    onValueChange={(value) => field.onChange(Number(value))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EXPIRY_CHOICES.map((days) => (
                        <SelectItem key={days} value={String(days)}>
                          {t("daysOption", { days })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" />}
              {t("createButton")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
