import type { DefaultSession } from "next-auth";
import type { Role, UserStatus } from "@/generated/prisma/enums";

declare module "next-auth" {
  interface User {
    role: Role;
    status: UserStatus;
    storeId: string | null;
    sid?: string;
  }

  interface Session {
    sid: string;
    user: {
      id: string;
      role: Role;
      status: UserStatus;
      storeId: string | null;
    } & DefaultSession["user"];
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    role: Role;
    status: UserStatus;
    storeId: string | null;
    sid: string;
  }
}
