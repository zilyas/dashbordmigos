/**
 * Shape of next-intl's resolved translator (useTranslations/getTranslations
 * return value), scoped to whatever values each message key needs. Every
 * buildXSchema(t) function in this directory takes one of these instead of
 * importing next-intl directly, so these files work unchanged whether the
 * caller is a client component (useTranslations) or a Server Action
 * (getTranslations) -- see each schema file's own comment for the pattern.
 */
export type ValidationT = (key: string, values?: Record<string, string | number | Date>) => string;
