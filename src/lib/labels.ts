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
