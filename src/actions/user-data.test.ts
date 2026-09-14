import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks for every collaborator user-data.ts touches. Hoisted so the
// `vi.mock` factories below (which run before imports) can reference them.
const {
  userFindUniqueMock,
  userUpdateMock,
  saleFindManyMock,
  activityLogFindManyMock,
  notificationFindManyMock,
  userSessionFindManyMock,
  twoFactorFindUniqueMock,
  getStorelessSessionContextMock,
  requirePlatformAdminMock,
  logActivityMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
  userFindUniqueMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  userUpdateMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  saleFindManyMock: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
  activityLogFindManyMock: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
  notificationFindManyMock: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
  userSessionFindManyMock: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
  twoFactorFindUniqueMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => null),
  getStorelessSessionContextMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  requirePlatformAdminMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  logActivityMock: vi.fn(async () => undefined),
  revalidatePathMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: userFindUniqueMock, update: userUpdateMock },
    sale: { findMany: saleFindManyMock },
    activityLog: { findMany: activityLogFindManyMock },
    notification: { findMany: notificationFindManyMock },
    userSession: { findMany: userSessionFindManyMock },
    twoFactorCredential: { findUnique: twoFactorFindUniqueMock },
  },
}));

vi.mock("@/lib/store-context", () => ({
  getStorelessSessionContext: getStorelessSessionContextMock,
}));

// requirePermission("manager.manage") is called once at module load to
// produce `requirePlatformAdmin`; the mock returns a stable function whose
// behavior each test controls via requirePlatformAdminMock.
vi.mock("@/lib/rbac-guards", () => ({
  requirePermission: vi.fn(() => requirePlatformAdminMock),
}));

vi.mock("@/lib/audit", () => ({ logActivity: logActivityMock }));

vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { exportUserData, requestUserDeletion } from "@/actions/user-data";

const SELF_SESSION = { userId: "user-1", role: "SELLER" as const, storeId: "store-1", sid: "sid-1" };
const ADMIN_SESSION = { userId: "admin-1", role: "SUPER_ADMIN" as const, storeId: null, sid: "sid-2" };

const TARGET_USER_ROW = {
  id: "user-1",
  name: "Jane Seller",
  email: "jane@example.com",
  role: "SELLER",
  storeId: "store-1",
  phone: "+1234",
  avatar: null,
  status: "ACTIVE",
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-02"),
  lastLogin: new Date("2026-01-03"),
  store: { id: "store-1", name: "Downtown", code: "DT" },
};

beforeEach(() => {
  vi.clearAllMocks();
  saleFindManyMock.mockResolvedValue([]);
  activityLogFindManyMock.mockResolvedValue([]);
  notificationFindManyMock.mockResolvedValue([]);
  userSessionFindManyMock.mockResolvedValue([]);
  twoFactorFindUniqueMock.mockResolvedValue(null);
});

describe("exportUserData", () => {
  it("rejects an unauthenticated caller", async () => {
    getStorelessSessionContextMock.mockResolvedValue(null);
    const result = await exportUserData();
    expect(result).toEqual({ error: "Not authorized" });
    expect(userFindUniqueMock).not.toHaveBeenCalled();
  });

  it("lets a user export their own data without passing an id", async () => {
    getStorelessSessionContextMock.mockResolvedValue(SELF_SESSION);
    userFindUniqueMock.mockResolvedValue(TARGET_USER_ROW);

    const result = await exportUserData();

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected success");
    expect(result.data.user.id).toBe("user-1");
    // passwordHash must never be selected, let alone returned.
    expect(result.data.user).not.toHaveProperty("passwordHash");
    expect(userFindUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "user-1" } }),
    );
    const findCallArg = userFindUniqueMock.mock.calls[0]?.[0] as { select: Record<string, unknown> };
    expect(findCallArg.select.passwordHash).toBeUndefined();
    expect(logActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "user.data_exported", entityId: "user-1", metadata: { self: true } }),
    );
  });

  it("blocks a non-admin from exporting someone else's data", async () => {
    getStorelessSessionContextMock.mockResolvedValue(SELF_SESSION);
    const result = await exportUserData("someone-else");
    expect(result).toEqual({ error: "Not authorized" });
    expect(userFindUniqueMock).not.toHaveBeenCalled();
  });

  it("lets SUPER_ADMIN export another user's data", async () => {
    getStorelessSessionContextMock.mockResolvedValue(ADMIN_SESSION);
    userFindUniqueMock.mockResolvedValue(TARGET_USER_ROW);

    const result = await exportUserData("user-1");

    expect(result.success).toBe(true);
    expect(logActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "admin-1", entityId: "user-1", metadata: { self: false } }),
    );
  });

  it("excludes the raw session token and 2FA secret from the export", async () => {
    getStorelessSessionContextMock.mockResolvedValue(SELF_SESSION);
    userFindUniqueMock.mockResolvedValue(TARGET_USER_ROW);
    userSessionFindManyMock.mockResolvedValue([{ id: "s1", ipAddress: "1.2.3.4" }]);
    twoFactorFindUniqueMock.mockResolvedValue({ enabled: true });

    const result = await exportUserData();

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected success");
    expect(result.data.twoFactorEnabled).toBe(true);
    const sessionCallArg = userSessionFindManyMock.mock.calls[0]?.[0] as { select: Record<string, unknown> };
    expect(sessionCallArg.select.tokenId).toBeUndefined();
    const twoFactorCallArg = twoFactorFindUniqueMock.mock.calls[0]?.[0] as { select: Record<string, unknown> };
    expect(twoFactorCallArg.select).toEqual({ enabled: true });
  });

  it("returns an error when the target user does not exist", async () => {
    getStorelessSessionContextMock.mockResolvedValue(SELF_SESSION);
    userFindUniqueMock.mockResolvedValue(null);
    const result = await exportUserData();
    expect(result).toEqual({ error: "User not found" });
  });
});

describe("requestUserDeletion", () => {
  it("requires the exact confirmation text", async () => {
    requirePlatformAdminMock.mockResolvedValue({ user: { id: "admin-1", storeId: null } });
    const result = await requestUserDeletion("user-1", "delete");
    expect(result).toEqual({ error: 'Type "DELETE" to confirm.' });
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it("blocks a SUPER_ADMIN from deleting their own account", async () => {
    requirePlatformAdminMock.mockResolvedValue({ user: { id: "admin-1", storeId: null } });
    const result = await requestUserDeletion("admin-1", "DELETE");
    expect(result).toEqual({ error: "You cannot delete your own account this way." });
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it("returns an error when the target user does not exist", async () => {
    requirePlatformAdminMock.mockResolvedValue({ user: { id: "admin-1", storeId: null } });
    userFindUniqueMock.mockResolvedValue(null);
    const result = await requestUserDeletion("user-1", "DELETE");
    expect(result).toEqual({ error: "User not found" });
  });

  it("refuses to re-delete an already-anonymized account", async () => {
    requirePlatformAdminMock.mockResolvedValue({ user: { id: "admin-1", storeId: null } });
    userFindUniqueMock.mockResolvedValue({ ...TARGET_USER_ROW, email: "deleted-user-1@deleted.invalid" });
    const result = await requestUserDeletion("user-1", "DELETE");
    expect(result).toEqual({ error: "This account has already been deleted." });
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it("anonymizes PII in place, sets status INACTIVE, and logs the request", async () => {
    requirePlatformAdminMock.mockResolvedValue({ user: { id: "admin-1", storeId: null } });
    userFindUniqueMock.mockResolvedValue(TARGET_USER_ROW);

    const result = await requestUserDeletion("user-1", "DELETE");

    expect(result).toEqual({ success: true });
    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: {
        name: "Deleted User",
        email: "deleted-user-1@deleted.invalid",
        phone: null,
        avatar: null,
        status: "INACTIVE",
      },
    });
    expect(logActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "user.deletion_requested",
        userId: "admin-1",
        entityId: "user-1",
        metadata: { role: "SELLER" },
      }),
    );
  });

  it("propagates the permission guard's rejection for a non-admin caller", async () => {
    requirePlatformAdminMock.mockRejectedValue(new Error("Not authorized"));
    await expect(requestUserDeletion("user-1", "DELETE")).rejects.toThrow("Not authorized");
    expect(userUpdateMock).not.toHaveBeenCalled();
  });
});
