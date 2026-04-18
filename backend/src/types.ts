import type { User } from '@prisma/client';

export type AuthSession = {
  userId: string;
  telegramUserId: string;
  username?: string | null;
};

export type AppVariables = {
  requestId: string;
  authSession: AuthSession;
  currentUser: User;
  skipPrismaDisconnect?: boolean;
};
