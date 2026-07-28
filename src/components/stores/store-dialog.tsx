"use client";

import { useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { ImageUploader } from "@/components/products/image-uploader";
import { createStore, updateStore } from "@/actions/stores";
import { storeSchema, type StoreInput } from "@/lib/validations/store";
import type { StoreListItem } from "@/lib/queries/stores";

export function StoreDialog({
  open,
  onOpenChange,
  store,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  store: StoreListItem | null;
}) {
  const [isPending, startTransition] = useTransition();
  const isEdit = !!store;

  const form = useForm<StoreInput>({
    resolver: zodResolver(storeSchema),
    values: isEdit
      ? {
          name: store.name,
          code: store.code,
          currency: store.currency,
          taxRate: store.taxRate,
          address: store.address ?? "",
          city: store.city ?? "",
          country: store.country ?? "",
          phone: store.phone ?? "",
          email: store.email ?? "",
          logo: store.logo ?? "",
        }
      : undefined,
    defaultValues: {
      name: "",
      code: "",
      currency: "USD",
      taxRate: 0,
      address: "",
      city: "",
      country: "",
      phone: "",
      email: "",
      logo: "",
    },
  });

  function onSubmit(values: StoreInput) {
    startTransition(async () => {
      const result = isEdit ? await updateStore(store.id, values) : await createStore(values);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success(isEdit ? "Store updated" : "Store created");
      onOpenChange(false);
      form.reset();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit store" : "New store"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Update this store's details." : "Create a new store on the platform."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <FieldGroup>
            <Field>
              <FieldLabel>Logo</FieldLabel>
              <Controller
                control={form.control}
                name="logo"
                render={({ field }) => (
                  <ImageUploader
                    value={field.value ? [field.value] : []}
                    onChange={(urls) => field.onChange(urls[0] ?? "")}
                    max={1}
                  />
                )}
              />
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field data-invalid={!!form.formState.errors.name}>
                <FieldLabel htmlFor="store-name">Store name</FieldLabel>
                <Input id="store-name" {...form.register("name")} />
                {form.formState.errors.name && (
                  <FieldError>{form.formState.errors.name.message}</FieldError>
                )}
              </Field>
              <Field data-invalid={!!form.formState.errors.code}>
                <FieldLabel htmlFor="store-code">Store code</FieldLabel>
                <Input id="store-code" placeholder="NYC-01" {...form.register("code")} />
                {form.formState.errors.code && (
                  <FieldError>{form.formState.errors.code.message}</FieldError>
                )}
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field data-invalid={!!form.formState.errors.currency}>
                <FieldLabel htmlFor="store-currency">Currency</FieldLabel>
                <Input id="store-currency" placeholder="USD" maxLength={3} {...form.register("currency")} />
                {form.formState.errors.currency && (
                  <FieldError>{form.formState.errors.currency.message}</FieldError>
                )}
              </Field>
              <Field data-invalid={!!form.formState.errors.taxRate}>
                <FieldLabel htmlFor="store-taxRate">Tax rate (%)</FieldLabel>
                <Input
                  id="store-taxRate"
                  type="number"
                  step="0.1"
                  {...form.register("taxRate", { valueAsNumber: true })}
                />
                {form.formState.errors.taxRate && (
                  <FieldError>{form.formState.errors.taxRate.message}</FieldError>
                )}
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="store-city">City</FieldLabel>
                <Input id="store-city" {...form.register("city")} />
              </Field>
              <Field>
                <FieldLabel htmlFor="store-country">Country</FieldLabel>
                <Input id="store-country" {...form.register("country")} />
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="store-address">Address</FieldLabel>
              <Input id="store-address" {...form.register("address")} />
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="store-phone">Phone</FieldLabel>
                <Input id="store-phone" {...form.register("phone")} />
              </Field>
              <Field data-invalid={!!form.formState.errors.email}>
                <FieldLabel htmlFor="store-email">Email</FieldLabel>
                <Input id="store-email" type="email" {...form.register("email")} />
                {form.formState.errors.email && (
                  <FieldError>{form.formState.errors.email.message}</FieldError>
                )}
              </Field>
            </div>
          </FieldGroup>
          <DialogFooter className="mt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" />}
              {isEdit ? "Save changes" : "Create store"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
