import { getRequestConfig } from "next-intl/server";
import { DEFAULT_LOCALE, messagesByLocale } from "./messages";

/**
 * The ROOT provider's config, AND the config every `getTranslations()` /
 * `getFormatter()` call in a Server Component or Server Action resolves
 * through (next-intl always routes through this file, regardless of where
 * the call happens). No cookies()/headers()/auth() read -- any request-scoped
 * read here would make every route under the root layout dynamic, including
 * /offline/pos, which must stay static (`next build` must print `○` for it;
 * see its own top comment).
 *
 * `params.locale` is populated ONLY when a caller explicitly passes one, e.g.
 * `getTranslations({ locale: toAppLocale(session.locale), namespace })` --
 * the pattern used by every Server Action and locale-aware Server Component
 * in this app. Honoring it here is what makes those calls actually resolve
 * to the user's stored language; it is never read from a request header, so
 * the no-request-scoped-read contract for /offline/pos and the root layout is
 * unaffected -- a render that never passes an explicit locale still gets
 * DEFAULT_LOCALE exactly as before.
 *
 * The root layout's own provider (src/app/layout.tsx) never passes a locale,
 * so it is unaffected and stays on DEFAULT_LOCALE forever, as designed.
 * (dashboard)/layout.tsx and offline-pos-client.tsx each still nest their own
 * <NextIntlClientProvider> for CLIENT Components, keyed off the signed-in
 * user's `locale` / the offline snapshot's cached locale -- that mechanism is
 * separate from this file and unaffected by this change. See
 * src/i18n/messages.ts for the full catalog both locales draw from.
 */
export default getRequestConfig(async ({ locale }) => {
  const resolved = locale && locale in messagesByLocale ? (locale as keyof typeof messagesByLocale) : DEFAULT_LOCALE;
  return { locale: resolved, messages: messagesByLocale[resolved] };
});
