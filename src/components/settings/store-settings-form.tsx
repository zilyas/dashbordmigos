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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ImageUploader } from "@/components/products/image-uploader";
import { updateStoreSettings } from "@/actions/settings";
import { COMMON_TIMEZONES } from "@/lib/timezone";
import { storeSettingsSchema, type StoreSettingsInput } from "@/lib/validations/settings";
import type { StoreSettings } from "@/lib/queries/settings";
import type { StoreFeaturesInput } from "@/lib/validations/settings";

const FEATURE_TOGGLES: { key: keyof StoreFeaturesInput; label: string; description: string }[] = [
  {
    key: "units_enabled",
    label: "Units of measure",
    description: "Sell by piece, kg, g, L or pack. Adds a unit field on products.",
  },
  {
    key: "category_attributes_enabled",
    label: "Category attributes",
    description: "Add structured specs per category (brand, warranty, weight…). Coming in a later update.",
  },
  {
    key: "custom_variant_axes_enabled",
    label: "Custom variant axes",
    description: "Define your own variant axes beyond Size/Color (Storage, Voltage…). Coming in a later update.",
  },
  {
    key: "expiry_batch_enabled",
    label: "Expiry & batch tracking",
    description: "Track expiry dates and batches for perishable goods. Coming in a later update.",
  },
];

export function StoreSettingsForm({ settings }: { settings: StoreSettings }) {
  const [isPending, startTransition] = useTransition();

  // Curated list, plus the store's current value if it isn't in the list.
  const timezoneOptions = Array.from(new Set<string>([...COMMON_TIMEZONES, settings.timezone]));

  const form = useForm<StoreSettingsInput>({
    resolver: zodResolver(storeSettingsSchema),
    defaultValues: {
      storeName: settings.storeName,
      currency: settings.currency,
      timezone: settings.timezone,
      taxRate: settings.taxRate,
      allowSellerViewCost: settings.allowSellerViewCost,
      address: settings.address ?? "",
      city: settings.city ?? "",
      country: settings.country ?? "",
      phone: settings.phone ?? "",
      email: settings.email ?? "",
      logo: settings.logo ?? "",
      features: settings.features,
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

            <Field data-invalid={!!form.formState.errors.timezone}>
              <FieldLabel htmlFor="timezone">Timezone</FieldLabel>
              <Controller
                control={form.control}
                name="timezone"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="timezone"><SelectValue placeholder="Select timezone" /></SelectTrigger>
                    <SelectContent>
                      {timezoneOptions.map((tz) => (
                        <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldDescription>Used for date-based rules like batch expiry.</FieldDescription>
              {form.formState.errors.timezone && (
                <FieldError>{form.formState.errors.timezone.message}</FieldError>
              )}
            </Field>

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

          <div className="flex flex-col gap-3 rounded-lg border p-4">
            <div>
              <p className="text-sm font-medium">Advanced features</p>
              <p className="text-xs text-muted-foreground">
                Off by default. Turn on only what your store needs — simple stores can ignore these.
              </p>
            </div>
            {FEATURE_TOGGLES.map((f) => (
              <Field
                key={f.key}
                orientation="responsive"
                className="justify-between gap-3 border-t pt-3 first:border-t-0 first:pt-0"
              >
                <div>
                  <FieldLabel htmlFor={f.key}>{f.label}</FieldLabel>
                  <FieldDescription>{f.description}</FieldDescription>
                </div>
                <Controller
                  control={form.control}
                  name={`features.${f.key}` as const}
                  render={({ field }) => (
                    <Switch id={f.key} checked={field.value} onCheckedChange={field.onChange} />
                  )}
                />
              </Field>
            ))}
          </div>

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
