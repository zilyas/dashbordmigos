import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AppLocale } from "@/i18n/messages";

const EXAMPLE_KEYS = ["readCatalogue", "readStock", "placeOrder"] as const;

const EXAMPLE_CODE: Record<(typeof EXAMPLE_KEYS)[number], string> = {
  readCatalogue: `curl "https://your-site.example/api/v1/products?limit=50" \\
  -H "Authorization: Bearer sk_live_xxx"`,
  readStock: `curl "https://your-site.example/api/v1/stock?ids=PRODUCT_ID_1,PRODUCT_ID_2" \\
  -H "Authorization: Bearer sk_live_xxx"`,
  placeOrder: `curl -X POST "https://your-site.example/api/v1/orders" \\
  -H "Authorization: Bearer sk_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "idempotencyKey": "order-2026-0001",
    "customerName": "Sara B.",
    "customerPhone": "0600000000",
    "items": [{ "productId": "PRODUCT_ID_1", "quantity": 2 }]
  }'`,
};

export async function IntegrationGuide({ locale }: { locale: AppLocale }) {
  const t = await getTranslations({ locale, namespace: "integrations.guide" });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>
          {t.rich("description", { code: (chunks) => <code className="font-mono">{chunks}</code> })}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <p className="font-medium text-destructive">{t("secretWarningTitle")}</p>
          <p className="mt-1 text-muted-foreground">
            {t("secretWarningBody")}
          </p>
        </div>

        {EXAMPLE_KEYS.map((key) => (
          <div key={key} className="flex flex-col gap-1.5">
            <p className="text-sm font-medium">{t(`examples.${key}.title`)}</p>
            <p className="text-sm text-muted-foreground">{t(`examples.${key}.description`)}</p>
            <pre className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs">
              {EXAMPLE_CODE[key]}
            </pre>
          </div>
        ))}

        <p className="text-sm text-muted-foreground">
          {t("variantFootnote")}
        </p>
      </CardContent>
    </Card>
  );
}
