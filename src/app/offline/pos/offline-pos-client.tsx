"use client";

import { useEffect, useState } from "react";
import { NextIntlClientProvider, useTranslations } from "next-intl";
import { POSTerminal } from "@/components/sales/pos-terminal";
import type { OfflineConfig } from "@/lib/offline/db";
import { loadOfflineState } from "@/lib/offline/sync";
import { messagesByLocale, toAppLocale } from "@/i18n/messages";

/**
 * The offline till's client entry point.
 *
 * Everything on screen comes from IndexedDB. Nothing here may fetch: this
 * component is mounted by a page the service worker served from its precache,
 * on a device whose network is gone, so a fetch would only hang.
 *
 * This used to render a status card -- "N products available from this
 * device" -- because it was written while db.ts was still being built and
 * could not import it. A cashier in airplane mode therefore saw a summary and
 * no way to sell anything, which is the whole feature failing while every
 * unit test passed. It now mounts the real POSTerminal, whose offline branch
 * already does the selling.
 */

type Ready = {
  config: OfflineConfig;
  /** Only used to decide whether there is anything to sell from. */
  catalogueSize: number;
};

/**
 * Everything below here renders in a `<NextIntlClientProvider>` keyed off
 * this device's cached locale, overriding the root layout's fixed-English
 * provider -- not the other way around, so `useTranslations` resolves
 * correctly for both locales once mounted. Before the IndexedDB read
 * resolves, the locale isn't known yet; "Opening the till…" renders in
 * whatever the root default is until then, which is the only moment this
 * till is ever in English without a cashier having chosen it.
 */
function OfflinePOSContent({ state, loaded }: { state: Ready | null; loaded: boolean }) {
  const t = useTranslations("offline.pos");

  if (!loaded) {
    return <p className="pos-offline-note">{t("openingTill")}</p>;
  }

  // No catalogue means this device never opened the POS while connected, so
  // there is nothing to sell from. Say that instead of showing an empty
  // product grid, which reads as "the shop has no stock".
  if (!state || state.catalogueSize === 0) {
    return <p className="pos-offline-note">{t("noCatalogue")}</p>;
  }

  // `products` is empty on purpose. POSTerminal's offline branch reads the
  // cached catalogue from IndexedDB itself; this prop feeds only the online
  // path, which cannot run here. Passing [] keeps the component honest rather
  // than mapping cached rows into POSProduct shapes that would need a
  // fabricated cost price and image URL -- neither of which is cached, and
  // neither of which may ever be invented.
  return (
    <div className="pos-offline-till">
      <POSTerminal
        // Always [] here: this page is served from the worker's precache and
        // has no server data. Force cacheOnly=true so the terminal always reads
        // from IndexedDB, never from the (empty) products prop.
        products={[]}
        cacheOnly={true}
        taxRate={state.config.taxRate}
        currency={state.config.currency}
        storeName={state.config.storeName}
        sellerName={state.config.userName ?? "Seller"}
        unitsEnabled={state.config.unitsEnabled}
        isManager={state.config.role === "MANAGER"}
      />
    </div>
  );
}

export function OfflinePOSClient() {
  const [state, setState] = useState<Ready | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const offline = await loadOfflineState();
        if (cancelled) return;
        setState(
          offline.header
            ? { config: offline.header.config, catalogueSize: offline.products.length }
            : null
        );
      } catch {
        // A blocked or broken IndexedDB must not blank the till: render the
        // never-primed message instead, which at least tells the cashier why.
        if (!cancelled) setState(null);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const locale = toAppLocale(state?.config.locale);

  return (
    <NextIntlClientProvider locale={locale} messages={messagesByLocale[locale]}>
      <OfflinePOSContent state={state} loaded={loaded} />
    </NextIntlClientProvider>
  );
}
