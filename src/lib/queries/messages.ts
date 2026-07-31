import { prisma } from "@/lib/prisma";

const PARTICIPANT_USER_SELECT = { id: true, name: true, avatar: true, role: true } as const;

/**
 * Unread message count per conversation for `userId`, in a single grouped
 * query instead of one `count()` per conversation (each participant row has
 * a different `lastReadAt` cutoff, so this can't be expressed as a normal
 * Prisma `groupBy`). Conversations with zero unread messages are simply
 * absent from the map.
 */
async function getUnreadCountsByConversation(userId: string): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<{ conversationId: string; unreadCount: number }[]>`
    SELECT cp."conversationId" AS "conversationId", COUNT(m.id)::int AS "unreadCount"
    FROM "conversation_participants" cp
    JOIN "messages" m
      ON m."conversationId" = cp."conversationId"
      AND m."senderId" != ${userId}
      AND m."createdAt" > COALESCE(cp."lastReadAt", to_timestamp(0))
    WHERE cp."userId" = ${userId}
    GROUP BY cp."conversationId"
  `;
  return new Map(rows.map((r) => [r.conversationId, Number(r.unreadCount)]));
}

export async function getConversationList(userId: string) {
  const [participations, unreadCounts] = await Promise.all([
    prisma.conversationParticipant.findMany({
      where: { userId },
      include: {
        conversation: {
          include: {
            participants: { include: { user: { select: PARTICIPANT_USER_SELECT } } },
            messages: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { id: true, body: true, senderId: true, createdAt: true },
            },
          },
        },
      },
    }),
    getUnreadCountsByConversation(userId),
  ]);

  const conversations = participations.map((p) => ({
    id: p.conversation.id,
    isGroup: p.conversation.isGroup,
    title: p.conversation.title,
    participants: p.conversation.participants.map((cp) => cp.user),
    lastMessage: p.conversation.messages[0] ?? null,
    unreadCount: unreadCounts.get(p.conversationId) ?? 0,
    updatedAt: p.conversation.updatedAt,
  }));

  return conversations.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

export async function getConversationMessages(conversationId: string, userId: string) {
  const participant = await prisma.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  });
  if (!participant) return null;

  const [messages, participants] = await Promise.all([
    prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
      include: { sender: { select: PARTICIPANT_USER_SELECT } },
    }),
    prisma.conversationParticipant.findMany({
      where: { conversationId },
      include: { user: { select: PARTICIPANT_USER_SELECT } },
    }),
  ]);

  return { messages, participants };
}

/** Finds an existing exact 1:1 conversation between two users, if any. */
export async function findDirectConversation(userAId: string, userBId: string) {
  return prisma.conversation.findFirst({
    where: {
      isGroup: false,
      participants: { every: { userId: { in: [userAId, userBId] } } },
      AND: [{ participants: { some: { userId: userAId } } }, { participants: { some: { userId: userBId } } }],
    },
  });
}

export async function getTotalUnreadMessageCount(userId: string) {
  const unreadCounts = await getUnreadCountsByConversation(userId);
  return Array.from(unreadCounts.values()).reduce((sum, c) => sum + c, 0);
}
