import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe Auth.js config: no providers/DB access here so this can be
 * imported from middleware (edge runtime). The Credentials provider with
 * its Prisma lookup lives in `auth.ts`, only ever invoked in Node runtime.
 */
export const authConfig = {
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
    // POS dashboard: 24 hours. Balances security (limits stale sessions at
    // shared terminals) with usability (covers typical retail shift length).
    // Users with Remember Me get 30 days via explicit UserSession (auth.ts).
    maxAge: 24 * 60 * 60,
  },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.role = user.role;
        token.status = user.status;
        token.storeId = user.storeId;
        token.sid = user.sid as string;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.role = token.role;
        session.user.status = token.status;
        session.user.storeId = token.storeId;
      }
      session.sid = token.sid;
      return session;
    },
  },
} satisfies NextAuthConfig;
