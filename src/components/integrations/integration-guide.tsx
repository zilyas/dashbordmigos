import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const EXAMPLES = [
  {
    title: "Read the catalogue",
    description:
      "Walk the full catalogue with nextCursor, or pass updatedSince to poll for what changed.",
    code: `curl "https://your-site.example/api/v1/products?limit=50" \\
  -H "Authorization: Bearer sk_live_xxx"`,
  },
  {
    title: "Read stock levels",
    description:
      "The cheap, frequent call. Pass ids for the items in a cart, or updatedSince to poll for movement.",
    code: `curl "https://your-site.example/api/v1/stock?ids=PRODUCT_ID_1,PRODUCT_ID_2" \\
  -H "Authorization: Bearer sk_live_xxx"`,
  },
  {
    title: "Place an order",
    description:
      "Stock goes down at once. Send the same idempotencyKey again after a timeout: the order is not counted twice.",
    code: `curl -X POST "https://your-site.example/api/v1/orders" \\
  -H "Authorization: Bearer sk_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "idempotencyKey": "order-2026-0001",
    "customerName": "Sara B.",
    "customerPhone": "0600000000",
    "items": [{ "productId": "PRODUCT_ID_1", "quantity": 2 }]
  }'`,
  },
];

export function IntegrationGuide() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect your website</CardTitle>
        <CardDescription>
          Send the key as <code className="font-mono">Authorization: Bearer &lt;key&gt;</code> from
          your server, never from the browser.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <p className="font-medium text-destructive">The key is a server secret.</p>
          <p className="mt-1 text-muted-foreground">
            This API sends no CORS headers on purpose, so a call from browser JavaScript will fail. A
            key put into front-end code is public: anyone can read it and use it.
          </p>
        </div>

        {EXAMPLES.map((example) => (
          <div key={example.title} className="flex flex-col gap-1.5">
            <p className="text-sm font-medium">{example.title}</p>
            <p className="text-sm text-muted-foreground">{example.description}</p>
            <pre className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs">
              {example.code}
            </pre>
          </div>
        ))}

        <p className="text-sm text-muted-foreground">
          For a product with variants, add the variantId of the chosen variant to each order item.
        </p>
      </CardContent>
    </Card>
  );
}
