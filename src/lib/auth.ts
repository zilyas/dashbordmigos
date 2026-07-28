import { randomUUID } from "crypto";
import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import { authConfig } from "@/lib/auth.config";
import { logActivity } from "@/lib/audit";
import { loginSchema } from "@/lib/validations/auth";
import { hashPassword, needsRehash, verifyPassword } from "@/lib/security/password";
import { extractRequestInfo, type RequestInfo } from "@/lib/security/request-info";
import { RATE_LIMITS, rateLimit, resetRateLimit } from "@/lib/security/rate-limit";
import { verifyTotpCode } from "@/lib/security/two-factor";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000;
const REMEMBER_ME_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

export class AccountLockedSignin extends CredentialsSignin {
  code = "account_locked";
}
export class RateLimitedSignin extends CredentialsSignin {
  code = "rate_limited";
}
export class TwoFactorRequiredSignin extends CredentialsSignin {
  code = "two_factor_required";
}
export class InvalidTwoFactorCodeSignin extends CredentialsSignin {
  code = "invalid_two_factor_code";
}

async function logAttempt(email: string, success: boolean, info: RequestInfo, failReason?: string) {
  await prisma.loginAttempt.create({
    data: {
      email,
      success,
      ipAddress: info.ipAddress,
      userAgent: info.userAgent,
      failReason: failReason ?? null,
    },
  });
}

/** Tries an entered code against the user's unused recovery codes, consuming it on a match. */
async function tryConsumeRecoveryCode(twoFactorId: string, code: string): Promise<boolean> {
  const candidates = await prisma.recoveryCode.findMany({
    where: { twoFactorId, usedAt: null },
    select: { id: true, codeHash: true },
  });
  for (const candidate of candidates) {
    if (await verifyPassword(code, candidate.codeHash)) {
      await prisma.recoveryCode.update({ where: { id: candidate.id }, data: { usedAt: new Date() } });
      return true;
    }
  }
  return false;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        code: { label: "Verification code", type: "text" },
        rememberMe: { label: "Remember me", type: "text" },
      },
      authorize: async (raw, request) => {
        const parsed = loginSchema.safeParse({
          email: raw?.email,
          password: raw?.password,
          code: typeof raw?.code === "string" && raw.code.trim().length > 0 ? raw.code.trim() : undefined,
          rememberMe: raw?.rememberMe === "true" || raw?.rememberMe === true,
        });
        if (!parsed.success) return null;
        const { password, code, rememberMe } = parsed.data;
        const email = parsed.data.email.toLowerCase();
        const info = extractRequestInfo(request.headers);

        const limitKey = `login:${info.ipAddress ?? "unknown"}:${email}`;
        const limit = rateLimit(limitKey, RATE_LIMITS.login);
        if (!limit.success) {
          await logAttempt(email, false, info, "rate_limited");
          throw new RateLimitedSignin();
        }

        const user = await prisma.user.findUnique({
          where: { email },
          include: { store: { select: { status: true } }, twoFactorCredential: true },
        });

        if (!user || user.status !== "ACTIVE" || (user.store && user.store.status !== "ACTIVE")) {
          await logAttempt(email, false, info, "invalid_credentials");
          return null;
        }

        if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
          await logAttempt(email, false, info, "account_locked");
          throw new AccountLockedSignin();
        }

        const validPassword = await verifyPassword(password, user.passwordHash);
        if (!validPassword) {
          await logAttempt(email, false, info, "invalid_credentials");
          const attempts = user.failedLoginAttempts + 1;
          await prisma.user.update({
            where: { id: user.id },
            data: {
              failedLoginAttempts: attempts,
              lockedUntil: attempts >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCKOUT_DURATION_MS) : null,
            },
          });
          return null;
        }

        await prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginAttempts: 0,
            lockedUntil: null,
            lastLogin: new Date(),
            ...(needsRehash(user.passwordHash) ? { passwordHash: await hashPassword(password) } : {}),
          },
        });

        if (user.twoFactorCredential?.enabled) {
          if (!code) {
            await logAttempt(email, false, info, "two_factor_required");
            throw new TwoFactorRequiredSignin();
          }
          const isTotp = /^\d{6}$/.test(code);
          const validCode = isTotp
            ? await verifyTotpCode(user.twoFactorCredential.secret, code)
            : await tryConsumeRecoveryCode(user.twoFactorCredential.id, code);
          if (!validCode) {
            await logAttempt(email, false, info, "invalid_two_factor_code");
            throw new InvalidTwoFactorCodeSignin();
          }
        }

        resetRateLimit(limitKey);
        await logAttempt(email, true, info);
        await logActivity({
          storeId: user.storeId,
          userId: user.id,
          action: "user.login",
          entity: "User",
          entityId: user.id,
          requestInfo: info,
        });

        const tokenId = randomUUID();
        const durationMs = rememberMe ? REMEMBER_ME_DURATION_MS : SESSION_DURATION_MS;
        await prisma.userSession.create({
          data: {
            userId: user.id,
            tokenId,
            ipAddress: info.ipAddress,
            userAgent: info.userAgent,
            browser: info.browser,
            os: info.os,
            rememberMe,
            expiresAt: new Date(Date.now() + durationMs),
          },
        });

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          status: user.status,
          storeId: user.storeId,
          image: user.avatar,
          sid: tokenId,
        };
      },
    }),
  ],
  events: {
    async signOut(message) {
      if ("token" in message && message.token?.sid) {
        await prisma.userSession.updateMany({
          where: { tokenId: message.token.sid as string, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: "user_logout" },
        });
      }
    },
  },
});
