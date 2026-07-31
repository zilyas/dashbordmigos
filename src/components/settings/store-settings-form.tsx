"use client";

import { useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel, FieldDescription } from "@/components/ui/field";
import { ImageUploader } from "@/components/products/image-uploader";
import { updateStoreSettings } from "@/actions/settings";
import { storeSettingsSchema, type StoreSettingsInput } from "@/lib/validations/settings";
import type { StoreSettings } from "@/lib/queries/settings";

export function StoreSettingsForm({ settings }: { settings: StoreSettings }) {
  const [isPending, startTransition] = useTransition();

  const form = useForm<StoreSettingsInput>({
    resolver: zodResolver(storeSettingsSchema),
    defaultValues: {
      storeName: settings.storeName,
      currency: settings.currency,
      taxRate: settings.taxRate,
      allowSellerViewCost: settings.allowSellerViewCost,
      address: settings.address ?? "",
      city: settings.city ?? "",
      country: settings.country ?? "",
      phone: settings.phone ?? "",
      email: settings.email ?? "",
      logo: settings.logo ?? "",
    },
  });

  function onSubmit(values: StoreSettingsInput) {
    startTransition(async () => {
      const result = await updateStoreSettings(values);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Settings saved");
    });
  }

  return (
    <Card>
      <CardHeader className="border-b pb-4">
        <CardTitle>Store details</CardTitle>
        <CardDescription>Shown on receipts, invoices and exported reports.</CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
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
              <Field data-invalid={!!form.formState.errors.storeName}>
                <FieldLabel htmlFor="storeName">Store name</FieldLabel>
                <Input id="storeName" {...form.register("storeName")} />
                {form.formState.errors.storeName && (
                  <FieldError>{form.formState.errors.storeName.message}</FieldError>
                )}
              </Field>
              <Field data-invalid={!!form.formState.errors.currency}>
                <FieldLabel htmlFor="currency">Currency code</FieldLabel>
                <Input id="currency" placeholder="MAD" maxLength={3} {...form.register("currency")} />
                {form.formState.errors.currency && (
                  <FieldError>{form.formState.errors.currency.message}</FieldError>
                )}
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field data-invalid={!!form.formState.errors.taxRate}>
                <FieldLabel htmlFor="taxRate">Tax rate (%)</FieldLabel>
                <Input
                  id="taxRate"
                  type="number"
                  step="0.1"
                  {...form.register("taxRate", { valueAsNumber: true })}
                />
                {form.formState.errors.taxRate && (
                  <FieldError>{form.formState.errors.taxRate.message}</FieldError>
                )}
              </Field>
              <Field>
                <FieldLabel htmlFor="phone">Phone</FieldLabel>
                <Input id="phone" {...form.register("phone")} />
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="city">City</FieldLabel>
                <Input id="city" {...form.register("city")} />
              </Field>
              <Field>
                <FieldLabel htmlFor="country">Country</FieldLabel>
                <Input id="country" {...form.register("country")} />
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="address">Address</FieldLabel>
                <Input id="address" {...form.register("address")} />
              </Field>
              <Field data-invalid={!!form.formState.errors.email}>
                <FieldLabel htmlFor="email">Store email</FieldLabel>
                <Input id="email" type="email" {...form.register("email")} />
                {form.formState.errors.email && (
                  <FieldError>{form.formState.errors.email.message}</FieldError>
                )}
              </Field>
            </div>

            <Field orientation="responsive" className="justify-between gap-3 rounded-lg border p-3">
              <div>
                <FieldLabel htmlFor="allowSellerViewCost">Sellers can see fabrication cost</FieldLabel>
                <FieldDescription>
                  When on, sellers see the cost price alongside selling price in Products.
                </FieldDescription>
              </div>
              <Controller
                control={form.control}
                name="allowSellerViewCost"
                render={({ field }) => (
                  <Switch
                    id="allowSellerViewCost"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                )}
              />
            </Field>
          </FieldGroup>

          <div className="flex justify-end">
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" />}
              Save changes
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
