"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LogOut, UserRound } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { logoutAction } from "@/actions/auth";
import { ROLE_LABELS } from "@/lib/labels";
import { initials } from "@/lib/utils";
import type { Role } from "@/generated/prisma/enums";

export function UserMenu({
  name,
  email,
  role,
  avatar,
}: {
  name: string;
  email: string;
  role: Role;
  avatar?: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleSignOut() {
    startTransition(async () => {
      await clearOfflineCacheOnSignOut();
      await logoutAction();
      router.push("/login");
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 gap-2 px-1.5">
          <Avatar className="size-6.5">
            {avatar && <AvatarImage src={avatar} alt={name} />}
            <AvatarFallback className="bg-primary/10 text-[11px] font-medium text-primary">
              {initials(name)}
            </AvatarFallback>
          </Avatar>
          <span className="hidden text-sm font-medium sm:inline">{name.split(" ")[0]}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">{name}</span>
          <span className="text-xs font-normal text-muted-foreground">{email}</span>
          <span className="mt-1 w-fit rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-secondary-foreground">
            {ROLE_LABELS[role]}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/account">
            <UserRound />
            Account settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" disabled={isPending} onClick={handleSignOut}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Wipe the signed-out user's offline data off this device.
 *
 * These are shared shop terminals: the cached catalogue, the recent-sales list
 * and the offline lease all belong to whoever just signed out, and leaving them
 * in IndexedDB hands the next cashier the previous user's store data without a
 * session — the same leak public/sw.js refuses to cache HTML for.
 *
 * PENDING SALES ARE NOT CLEARED, deliberately. An unsynced sale is cash already
 * in the drawer; dropping it on logout destroys the only record of it. It stays
 * until the server has acknowledged it, and the lease check at sync time
 * (src/lib/offline/lease-server.ts) decides whether it is accepted.
 *
 * `clearCachedData()` scopes its transaction to meta/products/recentSales and
 * does not name the pending store at all, so it cannot reach the queue even by
 * mistake. A test in src/lib/offline asserts that.
 */
async function clearOfflineCacheOnSignOut() {
  try {
    const { clearOfflineCacheOnLogout } = await import("@/lib/offline/sync");
    await clearOfflineCacheOnLogout();
  } catch {
    // Swallowed on purpose. A device with no IndexedDB, a blocked store, or a
    // browser that refuses the open must still be able to sign out — leaving a
    // cashier stuck signed in on a shared till is the worse failure.
  }
}
