import { prisma } from "@/lib/prisma";

const PARTICIPANT_USER_SELECT = { id: true, name: true, avatar: true, role: true } as const;

export async function getConversationList(userId: string) {
  const participations = await prisma.conversationParticipant.findMany({
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
  });

  const conversations = await Promise.all(
    participations.map(async (p) => {
      const unreadCount = await prisma.message.count({
        where: {
          conversationId: p.conversationId,
          senderId: { not: userId },
          createdAt: { gt: p.lastReadAt ?? new Date(0) },
        },
      });
      return {
        id: p.conversation.id,
        isGroup: p.conversation.isGroup,
        title: p.conversation.title,
        participants: p.conversation.participants.map((cp) => cp.user),
        lastMessage: p.conversation.messages[0] ?? null,
        unreadCount,
        updatedAt: p.conversation.updatedAt,
      };
    })
  );

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
  const participations = await prisma.conversationParticipant.findMany({
    where: { userId },
    select: { conversationId: true, lastReadAt: true },
  });

  const counts = await Promise.all(
    participations.map((p) =>
      prisma.message.count({
        where: {
          conversationId: p.conversationId,
          senderId: { not: userId },
          createdAt: { gt: p.lastReadAt ?? new Date(0) },
        },
      })
    )
  );

  return counts.reduce((sum, c) => sum + c, 0);
}
