import type { Metadata } from "next";
import { getSessionContext } from "@/lib/store-context";
import { getMessageableUsers } from "@/lib/messaging-permissions";
import { fetchConversations } from "@/actions/messages";
import { MessagesApp } from "@/components/messages/messages-app";

export const metadata: Metadata = { title: "Messages" };

export default async function MessagesPage() {
  const context = await getSessionContext();
  const [conversationsResult, messageableUsers] = await Promise.all([
    fetchConversations(),
    getMessageableUsers(context!),
  ]);

  return (
    <MessagesApp
      currentUserId={context!.userId}
      currentUserStoreId={context!.storeId}
      initialConversations={conversationsResult.success ? conversationsResult.conversations : []}
      messageableUsers={messageableUsers}
    />
  );
}
