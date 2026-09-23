"use client";

import { useState, useTransition } from "react";
import { useForm, useWatch, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
import { apiClientSchema, type ApiClientInput } from "@/lib/validations/api-client";
import { API_SCOPES, API_SCOPE_LABELS, type ApiScope } from "@/lib/api/scopes";
import { formatDateTime } from "@/lib/format";
import type { ApiClientItem } from "@/lib/queries/api-clients";

const EXPIRY_CHOICES = [30, 90, 180, 365];

export function ApiClientsManager({ clients }: { clients: ApiClientItem[] }) {
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
          New key
        </Button>
      </div>

      {clients.length === 0 ? (
        <EmptyState
          icon={<KeyRound />}
          title="No API keys yet"
          description="Make a key and give it to the person who builds your website."
          action={
            <Button onClick={openCreate} size="sm">
              New key
            </Button>
          }
        />
      ) : (
        <div className="rounded-xl border bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Permissions</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead>Made by</TableHead>
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
                      {client.scopes.map((scope) => (
                        <StatusBadge key={scope} variant="neutral">
                          {API_SCOPE_LABELS[scope as ApiScope] ?? scope}
                        </StatusBadge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge variant={client.status === "ACTIVE" ? "success" : "destructive"}>
                      {client.status === "ACTIVE" ? "Active" : "Revoked"}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {client.expiresAt ? formatDateTime(client.expiresAt) : "Never"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {client.lastUsedAt ? formatDateTime(client.lastUsedAt) : "Never"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {client.actor?.name ?? "Unknown"}
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
          title={`Revoke "${revokeTarget.name}"?`}
          description="The key stops working immediately and cannot be put back. Every website that uses it loses access until you make a new key."
          confirmLabel="Revoke"
          destructive
          onConfirm={async () => {
            const result = await revokeApiClient(revokeTarget.id);
            if ("error" in result) toast.error(result.error);
            else toast.success("Key revoked");
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
      toast.success("Key copied");
    } catch {
      toast.error("Could not copy. Select the key and copy it by hand.");
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
            <DialogTitle>Your new key</DialogTitle>
            <DialogDescription>
              This is the only time the key is shown. Store it somewhere safe. If you lose it, revoke
              this key and make a new one.
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
              Copy key
            </Button>
            <Button type="button" onClick={dismissMinted}>
              I have saved it
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
          <DialogTitle>New key</DialogTitle>
          <DialogDescription>
            A key lets one website read this shop&apos;s data. Give each website its own key.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            <Field data-invalid={!!form.formState.errors.name}>
              <FieldLabel htmlFor="api-client-name">Name</FieldLabel>
              <Input id="api-client-name" placeholder="e.g. Main website" {...form.register("name")} />
              {form.formState.errors.name && (
                <FieldError>{form.formState.errors.name.message}</FieldError>
              )}
            </Field>

            <Field data-invalid={!!form.formState.errors.scopes}>
              <FieldLabel>Permissions</FieldLabel>
              <div className="flex flex-col gap-2.5">
                {API_SCOPES.map((scope) => (
                  <div key={scope} className="flex items-center gap-2">
                    <Checkbox
                      id={`scope-${scope}`}
                      checked={scopes.includes(scope)}
                      onCheckedChange={(checked) => toggleScope(scope, checked === true)}
                    />
                    <label htmlFor={`scope-${scope}`} className="text-sm">
                      {API_SCOPE_LABELS[scope]}
                    </label>
                  </div>
                ))}
              </div>
              {form.formState.errors.scopes && (
                <FieldError>{form.formState.errors.scopes.message}</FieldError>
              )}
            </Field>

            <Field>
              <FieldLabel>Expires after</FieldLabel>
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
                          {days} days
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
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" />}
              Create key
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
