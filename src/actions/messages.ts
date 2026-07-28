"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSessionContext } from "@/lib/store-context";
import { canMessageUser, canMessageUsers, getMessageableUsers } from "@/lib/messaging-permissions";
import { findDirectConversation, getConversationList, getConversationMessages } from "@/lib/queries/messages";
import type { Role } from "@/generated/prisma/enums";

const MESSAGE_MAX_LENGTH = 4000;

export type ConversationSummary = {
  id: string;
  isGroup: boolean;
  title: string | null;
  participants: { id: string; name: string; avatar: string | null; role: Role }[];
  lastMessage: { id: string; body: string; senderId: string; createdAt: string } | null;
  unreadCount: number;
  updatedAt: string;
};

export type MessageItem = {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
  sender: { id: string; name: string; avatar: string | null; role: Role };
};

export type ParticipantSummary = {
  userId: string;
  lastReadAt: string | null;
  user: { id: string; name: string; avatar: string | null; role: Role };
};

/** Read-side wrapper so client components can poll for updates without a WebSocket. */
export async function fetchConversations() {
  const context = await getSessionContext();
  if (!context) return { error: "Not authorized" };
  const conversations = await getConversationList(context.userId);
  const result: ConversationSummary[] = conversations.map((c) => ({
    id: c.id,
    isGroup: c.isGroup,
    title: c.title,
    participants: c.participants.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, role: p.role })),
    lastMessage: c.lastMessage
      ? {
          id: c.lastMessage.id,
          body: c.lastMessage.body,
          senderId: c.lastMessage.senderId,
          createdAt: c.lastMessage.createdAt.toISOString(),
        }
      : null,
    unreadCount: c.unreadCount,
    updatedAt: c.updatedAt.toISOString(),
  }));
  return { success: true as const, conversations: result };
}

/** Read-side wrapper so client components can poll a thread for new messages. */
export async function fetchConversationMessages(conversationId: string) {
  const context = await getSessionContext();
  if (!context) return { error: "Not authorized" };
  const data = await getConversationMessages(conversationId, context.userId);
  if (!data) return { error: "Conversation not found." };

  const messages: MessageItem[] = data.messages.map((m) => ({
    id: m.id,
    senderId: m.senderId,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
    sender: { id: m.sender.id, name: m.sender.name, avatar: m.sender.avatar, role: m.sender.role },
  }));
  const participants: ParticipantSummary[] = data.participants.map((p) => ({
    userId: p.userId,
    lastReadAt: p.lastReadAt ? p.lastReadAt.toISOString() : null,
    user: { id: p.user.id, name: p.user.name, avatar: p.user.avatar, role: p.user.role },
  }));

  return { success: true as const, messages, participants };
}

export async function startDirectConversation(targetUserId: string) {
  const context = await getSessionContext();
  if (!context) return { error: "Not authorized" };

  const allowed = await canMessageUser(context, targetUserId);
  if (!allowed) return { error: "You can't message this person." };

  const existing = await findDirectConversation(context.userId, targetUserId);
  if (existing) return { success: true as const, conversationId: existing.id };

  const conversation = await prisma.conversation.create({
    data: {
      storeId: context.storeId,
      isGroup: false,
      createdById: context.userId,
      participants: {
        createMany: { data: [{ userId: context.userId }, { userId: targetUserId }] },
      },
    },
  });

  return { success: true as const, conversationId: conversation.id };
}

export type BroadcastTarget = "store" | "managers" | "sellers" | "selected";

export async function startGroupConversation(input: {
  title?: string;
  target: BroadcastTarget;
  selectedUserIds?: string[];
}) {
  const context = await getSessionContext();
  if (!context) return { error: "Not authorized" };

  let recipientIds: string[];
  if (input.target === "selected") {
    recipientIds = Array.from(new Set(input.selectedUserIds ?? []));
  } else {
    const messageable = await getMessageableUsers(context);
    if (input.target === "store") {
      recipientIds = messageable.filter((u) => u.storeId === context.storeId).map((u) => u.id);
    } else if (input.target === "managers") {
      recipientIds = messageable.filter((u) => u.role === "MANAGER").map((u) => u.id);
    } else {
      recipientIds = messageable.filter((u) => u.role === "SELLER").map((u) => u.id);
    }
  }

  if (recipientIds.length === 0) {
    return { error: "Select at least one recipient." };
  }

  const allowed = await canMessageUsers(context, recipientIds);
  if (!allowed) return { error: "You can't message one or more of the selected recipients." };

  const conversation = await prisma.conversation.create({
    data: {
      storeId: context.storeId,
      isGroup: true,
      title: input.title?.trim() || null,
      createdById: context.userId,
      participants: {
        createMany: {
          data: [context.userId, ...recipientIds].map((userId) => ({ userId })),
        },
      },
    },
  });

  return { success: true as const, conversationId: conversation.id };
}

export async function sendMessage(conversationId: string, body: string) {
  const context = await getSessionContext();
  if (!context) return { error: "Not authorized" };

  const trimmed = body.trim();
  if (!trimmed) return { error: "Message can't be empty." };
  if (trimmed.length > MESSAGE_MAX_LENGTH) return { error: "Message is too long." };

  const participant = await prisma.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId: context.userId } },
  });
  if (!participant) return { error: "Conversation not found." };

  const [message] = await prisma.$transaction([
    prisma.message.create({
      data: { conversationId, senderId: context.userId, body: trimmed },
    }),
    prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } }),
    prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId, userId: context.userId } },
      data: { lastReadAt: new Date() },
    }),
  ]);

  const otherParticipants = await prisma.conversationParticipant.findMany({
    where: { conversationId, userId: { not: context.userId } },
    select: { userId: true },
  });

  if (otherParticipants.length > 0) {
    const sender = await prisma.user.findUnique({ where: { id: context.userId }, select: { name: true } });
    await prisma.notification.createMany({
      data: otherParticipants.map((p) => ({
        storeId: context.storeId,
        userId: p.userId,
        type: "NEW_MESSAGE" as const,
        title: "New message",
        message: `${sender?.name ?? "Someone"}: ${trimmed.slice(0, 120)}`,
      })),
    });
  }

  revalidatePath("/messages");
  return { success: true as const, messageId: message.id };
}

export async function markConversationRead(conversationId: string) {
  const context = await getSessionContext();
  if (!context) return { error: "Not authorized" };

  await prisma.conversationParticipant.updateMany({
    where: { conversationId, userId: context.userId },
    data: { lastReadAt: new Date() },
  });

  revalidatePath("/messages");
  return { success: true as const };
}
