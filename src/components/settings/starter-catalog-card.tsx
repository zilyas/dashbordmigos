"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Loader2, Check, RotateCcw, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { applyCatalogTemplate, type ApplyTemplateResult } from "@/actions/catalog-templates";
import {
  CATALOG_TEMPLATES,
  featuresNewlyEnabled,
  type CatalogTemplate,
} from "@/lib/catalog-templates";
import type { StoreFeatures } from "@/lib/features";

const FEATURE_I18N_KEYS: Record<keyof StoreFeatures, string> = {
  units_enabled: "units",
  category_attributes_enabled: "categoryAttributes",
  custom_variant_axes_enabled: "customVariantAxes",
  expiry_batch_enabled: "expiryBatch",
  storefront_api_enabled: "storefrontApi",
};

function countLine(
  t: (key: string, values?: Record<string, string | number>) => string,
  label: string,
  created: number,
  reused: number
) {
  if (created === 0 && reused === 0) return null;
  return (
    <li className="flex items-center gap-2 text-sm">
      <span className="font-medium">{label}:</span>
      <span className="text-emerald-600 dark:text-emerald-400">{t("countAdded", { count: created })}</span>
      {reused > 0 && <span className="text-muted-foreground">· {t("countReused", { count: reused })}</span>}
    </li>
  );
}

function TemplatePreview({ template, features }: { template: CatalogTemplate; features: StoreFeatures }) {
  const t = useTranslations("settings.starterCatalog");
  const tFeatures = useTranslations("settings.storeDetails.features");
  const newFlags = featuresNewlyEnabled(features, template.features);
  return (
    <div className="flex flex-col gap-4 text-sm">
      {newFlags.length > 0 && (
        <section>
          <h4 className="mb-1 font-medium">{t("previewFeaturesTitle")}</h4>
          <ul className="list-disc pl-5 text-muted-foreground">
            {newFlags.map((f) => (
              <li key={f}>{tFeatures(`${FEATURE_I18N_KEYS[f]}.label`)}</li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h4 className="mb-1 font-medium">{t("previewCategoriesTitle")}</h4>
        <ul className="space-y-1 text-muted-foreground">
          {template.categories.map((c) => (
            <li key={c.name} className={c.parent ? "pl-4" : ""}>
              {c.name}
              {c.attributes && c.attributes.length > 0 && (
                <span className="text-xs"> — {c.attributes.map((a) => a.label).join(", ")}</span>
              )}
            </li>
          ))}
        </ul>
      </section>
      {template.axes && template.axes.length > 0 && (
        <section>
          <h4 className="mb-1 font-medium">{t("previewAxesTitle")}</h4>
          <p className="text-muted-foreground">{template.axes.join(", ")}</p>
        </section>
      )}
      {template.sizes && template.sizes.length > 0 && (
        <section>
          <h4 className="mb-1 font-medium">{t("previewSizesTitle")}</h4>
          <p className="text-muted-foreground">{template.sizes.join(", ")}</p>
        </section>
      )}
      {template.colors && template.colors.length > 0 && (
        <section>
          <h4 className="mb-1 font-medium">{t("previewColorsTitle")}</h4>
          <p className="text-muted-foreground">{template.colors.map((c) => c.name).join(", ")}</p>
        </section>
      )}
      <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
        {t("previewFooter")}
      </p>
    </div>
  );
}

export function StarterCatalogCard({
  features,
  catalogConfigured,
}: {
  features: StoreFeatures;
  catalogConfigured: boolean;
}) {
  const t = useTranslations("settings.starterCatalog");
  const tFeatures = useTranslations("settings.storeDetails.features");
  const [selected, setSelected] = useState<CatalogTemplate | null>(null);
  const [result, setResult] = useState<ApplyTemplateResult | null>(null);
  const [isPending, startTransition] = useTransition();

  function openPreview(template: CatalogTemplate) {
    setResult(null);
    setSelected(template);
  }

  function apply() {
    if (!selected) return;
    startTransition(async () => {
      const res = await applyCatalogTemplate(selected.key);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      setResult(res.result);
      toast.success(t("toastApplied", { templateName: res.result.templateName }));
    });
  }

  const templateGrid = (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {CATALOG_TEMPLATES.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => openPreview(t)}
          className="rounded-lg border border-border bg-background p-3 text-left transition-colors hover:bg-muted"
        >
          <span className="font-medium">{t.name}</span>
          <span className="mt-1 block text-xs text-muted-foreground">{t.description}</span>
        </button>
      ))}
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4" /> {t("title")}
        </CardTitle>
        <CardDescription>
          {t("description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {catalogConfigured ? (
          <details>
            <summary className="cursor-pointer text-sm text-muted-foreground select-none">
              {t("alreadySetUp")}
            </summary>
            <div className="mt-3">{templateGrid}</div>
          </details>
        ) : (
          templateGrid
        )}
      </CardContent>

      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open && !isPending) {
            setSelected(null);
            setResult(null);
          }
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          {selected && !result && (
            <>
              <DialogHeader>
                <DialogTitle>{selected.name} starter catalog</DialogTitle>
                <DialogDescription>{selected.description}</DialogDescription>
              </DialogHeader>
              <TemplatePreview template={selected} features={features} />
              <DialogFooter>
                <Button variant="outline" onClick={() => setSelected(null)} disabled={isPending}>
                  {t("cancel")}
                </Button>
                <Button onClick={apply} disabled={isPending}>
                  {isPending && <Loader2 className="size-4 animate-spin" />}
                  {t("applyButton")}
                </Button>
              </DialogFooter>
            </>
          )}
          {result && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Check className="size-5 text-emerald-500" /> {t("appliedTitle", { templateName: result.templateName })}
                </DialogTitle>
                <DialogDescription>{t("appliedDescription")}</DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-3 text-sm">
                {result.featuresEnabled.length > 0 && (
                  <p>
                    <span className="font-medium">{t("featuresEnabledPrefix")}</span>
                    {result.featuresEnabled
                      .map((f) => {
                        const i18nKey = FEATURE_I18N_KEYS[f as keyof StoreFeatures];
                        return i18nKey ? tFeatures(`${i18nKey}.label`) : f;
                      })
                      .join(", ")}
                  </p>
                )}
                <ul className="space-y-1">
                  {countLine(t, t("countCategories"), result.created.categories, result.reused.categories)}
                  {countLine(t, t("countAttributes"), result.created.attributes, result.reused.attributes)}
                  {countLine(t, t("countAxes"), result.created.axes, result.reused.axes)}
                  {countLine(t, t("countSizes"), result.created.sizes, result.reused.sizes)}
                  {countLine(t, t("countColors"), result.created.colors, result.reused.colors)}
                </ul>
                {(() => {
                  const anyCreated =
                    Object.values(result.created).reduce((a, b) => a + b, 0) > 0;
                  const anyReused = Object.values(result.reused).reduce((a, b) => a + b, 0) > 0;
                  if (!anyCreated && anyReused) {
                    return (
                      <p className="flex items-center gap-2 text-muted-foreground">
                        <RotateCcw className="size-4" /> {t("nothingChanged")}
                      </p>
                    );
                  }
                  return null;
                })()}
              </div>
              <DialogFooter>
                <Button
                  onClick={() => {
                    setSelected(null);
                    setResult(null);
                  }}
                >
                  {t("done")}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
