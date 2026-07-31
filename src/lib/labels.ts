import type {
  Role,
  UserStatus,
  StoreStatus,
  ProductStatus,
  PaymentMethod,
  MovementType,
} from "@/generated/prisma/enums";

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "Super Admin",
  MANAGER: "Manager",
  SELLER: "Seller",
};

export const USER_STATUS_LABELS: Record<UserStatus, string> = {
  ACTIVE: "Active",
  INACTIVE: "Inactive",
};

export const STORE_STATUS_LABELS: Record<StoreStatus, string> = {
  ACTIVE: "Active",
  INACTIVE: "Inactive",
};

export const PRODUCT_STATUS_LABELS: Record<ProductStatus, string> = {
  ACTIVE: "Active",
  DRAFT: "Draft",
  ARCHIVED: "Archived",
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: "Cash",
  CARD: "Card",
  TRANSFER: "Transfer",
  OTHER: "Other",
};

export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  IN: "Stock In",
  OUT: "Stock Out",
  RETURN: "Return",
  ADJUSTMENT: "Adjustment",
  SUPPLIER_DELIVERY: "Supplier Delivery",
  MANUAL_EDIT: "Manual Edit",
};

export const FAIL_REASON_LABELS: Record<string, string> = {
  invalid_credentials: "Invalid email or password",
  account_locked: "Account locked",
  rate_limited: "Rate limited",
  two_factor_required: "Two-factor code required",
  invalid_two_factor_code: "Invalid two-factor code",
};
