export type AuthSession = {
  userId: string;
  telegramUserId: string;
  username?: string | null;
};

export type AppVariables = {
  requestId: string;
  authSession: AuthSession;
};
