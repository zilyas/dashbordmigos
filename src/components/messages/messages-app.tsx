"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { MessageSquarePlus, Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { ConversationList } from "@/components/messages/conversation-list";
import { ThreadView } from "@/components/messages/thread-view";
import { NewConversationDialog } from "@/components/messages/new-conversation-dialog";
import {
  fetchConversationMessages,
  fetchConversations,
  markConversationRead,
  sendMessage,
  type ConversationSummary,
  type MessageItem,
  type ParticipantSummary,
} from "@/actions/messages";
import { conversationLabel } from "@/lib/messages-format";
import type { MessageableUser } from "@/lib/messaging-permissions";

const POLL_INTERVAL_MS = 4000;

export function MessagesApp({
  currentUserId,
  currentUserStoreId,
  initialConversations,
  messageableUsers,
}: {
  currentUserId: string;
  currentUserStoreId: string | null;
  initialConversations: ConversationSummary[];
  messageableUsers: MessageableUser[];
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const [selectedId, setSelectedId] = useState<string | null>(initialConversations[0]?.id ?? null);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [participants, setParticipants] = useState<ParticipantSummary[]>([]);
  const [search, setSearch] = useState("");
  const [newConversationOpen, setNewConversationOpen] = useState(false);
  const [isSending, startSendTransition] = useTransition();

  const selectedConversation = conversations.find((c) => c.id === selectedId) ?? null;

  const refreshConversations = useCallback(async () => {
    const result = await fetchConversations();
    if (result.success) setConversations(result.conversations);
  }, []);

  const refreshMessages = useCallback(async (conversationId: string) => {
    const result = await fetchConversationMessages(conversationId);
    if (result.success) {
      setMessages(result.messages);
      setParticipants(result.participants);
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") refreshConversations();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refreshConversations]);

  useEffect(() => {
    if (!selectedId) return;
    markConversationRead(selectedId);

    const tick = () => {
      if (document.visibilityState === "visible") refreshMessages(selectedId);
    };
    const timeout = setTimeout(tick, 0);
    const interval = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [selectedId, refreshMessages]);

  function handleSend(body: string) {
    if (!selectedId) return;
    startSendTransition(async () => {
      const result = await sendMessage(selectedId, body);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      await Promise.all([refreshMessages(selectedId), refreshConversations()]);
    });
  }

  function handleCreated(conversationId: string) {
    setNewConversationOpen(false);
    refreshConversations().then(() => setSelectedId(conversationId));
  }

  const filteredConversations = useMemo(() => {
    if (!search.trim()) return conversations;
    const q = search.toLowerCase();
    return conversations.filter((c) => conversationLabel(c, currentUserId).toLowerCase().includes(q));
  }, [conversations, search, currentUserId]);

  return (
    <div className="flex h-[calc(100vh-10rem)] min-h-[28rem] flex-col gap-4">
      <PageHeader
        title="Messages"
        description="Direct messages across your team."
        actions={
          <Button onClick={() => setNewConversationOpen(true)}>
            <MessageSquarePlus className="size-4" />
            New message
          </Button>
        }
      />
      <div className="flex flex-1 overflow-hidden rounded-xl border">
        <div className="flex w-full max-w-xs shrink-0 flex-col border-r">
          <div className="border-b p-3">
            <div className="relative">
              <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search conversations"
                className="pl-8"
              />
            </div>
          </div>
          <ConversationList
            conversations={filteredConversations}
            currentUserId={currentUserId}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </div>
        <div className="flex flex-1 flex-col">
          <ThreadView
            conversation={selectedConversation}
            messages={messages}
            participants={participants}
            currentUserId={currentUserId}
            onSend={handleSend}
            isSending={isSending}
          />
        </div>
      </div>

      <NewConversationDialog
        open={newConversationOpen}
        onOpenChange={setNewConversationOpen}
        messageableUsers={messageableUsers}
        currentUserStoreId={currentUserStoreId}
        onCreated={handleCreated}
      />
    </div>
  );
}
