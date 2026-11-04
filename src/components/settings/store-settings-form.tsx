"use client";

import { useMemo, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
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
import { buildStoreSettingsSchema, type StoreSettingsInput } from "@/lib/validations/settings";
import type { StoreSettings } from "@/lib/queries/settings";
import type { StoreFeaturesInput } from "@/lib/validations/settings";

const FEATURE_KEYS: { key: keyof StoreFeaturesInput; i18nKey: string }[] = [
  { key: "units_enabled", i18nKey: "units" },
  { key: "category_attributes_enabled", i18nKey: "categoryAttributes" },
  { key: "custom_variant_axes_enabled", i18nKey: "customVariantAxes" },
  { key: "expiry_batch_enabled", i18nKey: "expiryBatch" },
];

// storefront_api_enabled is deliberately absent: only the owner grants a store
// API access, from Stores > Edit. updateStoreSettings pins it server-side too,
// so a hand-made request cannot flip it either.

export function StoreSettingsForm({ settings }: { settings: StoreSettings }) {
  const [isPending, startTransition] = useTransition();
  const t = useTranslations("settings.storeDetails");
  const tValidation = useTranslations("validation");
  const storeSettingsSchema = useMemo(
    () => buildStoreSettingsSchema(tValidation),
    [tValidation]
  );

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
      toast.success(t("toastSaved"));
    });
  }

  return (
    <Card>
      <CardHeader className="border-b pb-4">
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <FieldGroup>
            <Field>
              <FieldLabel>{t("logoLabel")}</FieldLabel>
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
                <FieldLabel htmlFor="storeName">{t("storeNameLabel")}</FieldLabel>
                <Input id="storeName" {...form.register("storeName")} />
                {form.formState.errors.storeName && (
                  <FieldError>{form.formState.errors.storeName.message}</FieldError>
                )}
              </Field>
              <Field data-invalid={!!form.formState.errors.currency}>
                <FieldLabel htmlFor="currency">{t("currencyCodeLabel")}</FieldLabel>
                <Input id="currency" placeholder="MAD" maxLength={3} {...form.register("currency")} />
                {form.formState.errors.currency && (
                  <FieldError>{form.formState.errors.currency.message}</FieldError>
                )}
              </Field>
            </div>

            <Field data-invalid={!!form.formState.errors.timezone}>
              <FieldLabel htmlFor="timezone">{t("timezoneLabel")}</FieldLabel>
              <Controller
                control={form.control}
                name="timezone"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="timezone"><SelectValue placeholder={t("timezonePlaceholder")} /></SelectTrigger>
                    <SelectContent>
                      {timezoneOptions.map((tz) => (
                        <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldDescription>{t("timezoneHint")}</FieldDescription>
              {form.formState.errors.timezone && (
                <FieldError>{form.formState.errors.timezone.message}</FieldError>
              )}
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field data-invalid={!!form.formState.errors.taxRate}>
                <FieldLabel htmlFor="taxRate">{t("taxRateLabel")}</FieldLabel>
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
                <FieldLabel htmlFor="phone">{t("phoneLabel")}</FieldLabel>
                <Input id="phone" {...form.register("phone")} />
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="city">{t("cityLabel")}</FieldLabel>
                <Input id="city" {...form.register("city")} />
              </Field>
              <Field>
                <FieldLabel htmlFor="country">{t("countryLabel")}</FieldLabel>
                <Input id="country" {...form.register("country")} />
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="address">{t("addressLabel")}</FieldLabel>
                <Input id="address" {...form.register("address")} />
              </Field>
              <Field data-invalid={!!form.formState.errors.email}>
                <FieldLabel htmlFor="email">{t("emailLabel")}</FieldLabel>
                <Input id="email" type="email" {...form.register("email")} />
                {form.formState.errors.email && (
                  <FieldError>{form.formState.errors.email.message}</FieldError>
                )}
              </Field>
            </div>

            <Field orientation="responsive" className="justify-between gap-3 rounded-lg border p-3">
              <div>
                <FieldLabel htmlFor="allowSellerViewCost">{t("allowSellerViewCostLabel")}</FieldLabel>
                <FieldDescription>
                  {t("allowSellerViewCostHint")}
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
              <p className="text-sm font-medium">{t("advancedFeaturesTitle")}</p>
              <p className="text-xs text-muted-foreground">
                {t("advancedFeaturesHint")}
              </p>
            </div>
            {FEATURE_KEYS.map((f) => (
              <Field
                key={f.key}
                orientation="responsive"
                className="justify-between gap-3 border-t pt-3 first:border-t-0 first:pt-0"
              >
                <div>
                  <FieldLabel htmlFor={f.key}>{t(`features.${f.i18nKey}.label`)}</FieldLabel>
                  <FieldDescription>{t(`features.${f.i18nKey}.description`)}</FieldDescription>
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
              {t("saveChanges")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
