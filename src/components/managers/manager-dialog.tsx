"use client";

import { useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { createManager, updateManager } from "@/actions/managers";
import {
  createManagerSchema,
  updateManagerSchema,
  type CreateManagerInput,
  type UpdateManagerInput,
} from "@/lib/validations/manager";
import type { ManagerListItem } from "@/lib/queries/users";

type StoreOption = { id: string; name: string; code: string };

export function CreateManagerDialog({
  open,
  onOpenChange,
  stores,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stores: StoreOption[];
}) {
  const [isPending, startTransition] = useTransition();
  const form = useForm<CreateManagerInput>({
    resolver: zodResolver(createManagerSchema),
    defaultValues: { name: "", email: "", password: "", phone: "", storeId: "" },
  });

  function onSubmit(values: CreateManagerInput) {
    startTransition(async () => {
      const result = await createManager(values);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Manager created");
      onOpenChange(false);
      form.reset();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New manager</DialogTitle>
          <DialogDescription>Create a manager account and assign a store.</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            <Field data-invalid={!!form.formState.errors.name}>
              <FieldLabel htmlFor="new-mgr-name">Full name</FieldLabel>
              <Input id="new-mgr-name" {...form.register("name")} />
              {form.formState.errors.name && <FieldError>{form.formState.errors.name.message}</FieldError>}
            </Field>
            <Field data-invalid={!!form.formState.errors.email}>
              <FieldLabel htmlFor="new-mgr-email">Email</FieldLabel>
              <Input id="new-mgr-email" type="email" {...form.register("email")} />
              {form.formState.errors.email && <FieldError>{form.formState.errors.email.message}</FieldError>}
            </Field>
            <Field data-invalid={!!form.formState.errors.password}>
              <FieldLabel htmlFor="new-mgr-password">Temporary password</FieldLabel>
              <Input id="new-mgr-password" {...form.register("password")} />
              {form.formState.errors.password && (
                <FieldError>{form.formState.errors.password.message}</FieldError>
              )}
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="new-mgr-phone">Phone</FieldLabel>
                <Input id="new-mgr-phone" {...form.register("phone")} />
              </Field>
              <Field data-invalid={!!form.formState.errors.storeId}>
                <FieldLabel>Store</FieldLabel>
                <Controller
                  control={form.control}
                  name="storeId"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select a store" />
                      </SelectTrigger>
                      <SelectContent>
                        {stores.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name} ({s.code})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                {form.formState.errors.storeId && (
                  <FieldError>{form.formState.errors.storeId.message}</FieldError>
                )}
              </Field>
            </div>
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" />}
              Create manager
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EditManagerDialog({
  open,
  onOpenChange,
  manager,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  manager: ManagerListItem;
}) {
  const [isPending, startTransition] = useTransition();
  const form = useForm<UpdateManagerInput>({
    resolver: zodResolver(updateManagerSchema),
    values: { name: manager.name, email: manager.email, phone: manager.phone ?? "" },
  });

  function onSubmit(values: UpdateManagerInput) {
    startTransition(async () => {
      const result = await updateManager(manager.id, values);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Manager updated");
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit manager</DialogTitle>
          <DialogDescription>Update this manager&apos;s details.</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            <Field data-invalid={!!form.formState.errors.name}>
              <FieldLabel htmlFor="edit-mgr-name">Full name</FieldLabel>
              <Input id="edit-mgr-name" {...form.register("name")} />
              {form.formState.errors.name && <FieldError>{form.formState.errors.name.message}</FieldError>}
            </Field>
            <Field data-invalid={!!form.formState.errors.email}>
              <FieldLabel htmlFor="edit-mgr-email">Email</FieldLabel>
              <Input id="edit-mgr-email" type="email" {...form.register("email")} />
              {form.formState.errors.email && <FieldError>{form.formState.errors.email.message}</FieldError>}
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-mgr-phone">Phone</FieldLabel>
              <Input id="edit-mgr-phone" {...form.register("phone")} />
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" />}
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
