import type {
  Role,
  UserStatus,
  StoreStatus,
  ProductStatus,
  PaymentMethod,
  MovementType,
} from "@/generated/prisma/enums";
import type { BatchStatus } from "@/lib/batches";

/**
 * Every function here takes an already-resolved translator scoped to the
 * "labels" namespace -- callers get `t` from `useTranslations("labels")`
 * (client components) or `getTranslations("labels")` (Server Components /
 * Server Actions) and pass it straight through. Centralized here, not
 * inlined at each of the 17 call sites, so the enum->key mapping stays in
 * one place if an enum value is ever renamed.
 */
type LabelsT = (key: string) => string;

export function roleLabel(t: LabelsT, role: Role): string {
  return t(`role.${role}`);
}

export function userStatusLabel(t: LabelsT, status: UserStatus): string {
  return t(`userStatus.${status}`);
}

export function storeStatusLabel(t: LabelsT, status: StoreStatus): string {
  return t(`storeStatus.${status}`);
}

export function productStatusLabel(t: LabelsT, status: ProductStatus): string {
  return t(`productStatus.${status}`);
}

export function batchStatusLabel(t: LabelsT, status: BatchStatus): string {
  return t(`batchStatus.${status}`);
}

export function paymentMethodLabel(t: LabelsT, method: PaymentMethod): string {
  return t(`paymentMethod.${method}`);
}

export function movementTypeLabel(t: LabelsT, type: MovementType): string {
  return t(`movementType.${type}`);
}

const KNOWN_FAIL_REASONS = [
  "invalid_credentials",
  "account_locked",
  "rate_limited",
  "two_factor_required",
  "invalid_two_factor_code",
] as const;

/** Falls back to the raw reason string for a value next-intl has no key for (e.g. a new reason added server-side before this table catches up). */
export function failReasonLabel(t: LabelsT, reason: string): string {
  const known = KNOWN_FAIL_REASONS.includes(reason as (typeof KNOWN_FAIL_REASONS)[number]);
  return known ? t(`failReason.${reason}`) : reason;
}

/** All PaymentMethod values, for building a full option list (Select, picker). */
export const PAYMENT_METHODS: PaymentMethod[] = ["CASH", "CARD", "TRANSFER", "OTHER"];
