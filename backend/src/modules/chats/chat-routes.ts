import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import type { AppVariables } from '../../types';
import { createChat, createMessage, getChatWithMessages, listChats } from './chat-service';

const createChatSchema = z.object({
  providerId: z.string().min(1),
  title: z.string().trim().min(1).max(120).optional(),
});

const createMessageSchema = z.object({
  content: z.string().min(1).max(12000),
  fileIds: z.array(z.string().min(1)).max(5).optional(),
});

export const chatRoutes = new Hono<{ Variables: AppVariables }>();

chatRoutes.use('*', authMiddleware);

chatRoutes.get('/', async (c) => {
  const session = c.get('authSession');
  const chats = await listChats(session.userId);
  return c.json({ chats });
});

chatRoutes.post('/', async (c) => {
  const session = c.get('authSession');
  const payload = createChatSchema.parse(await c.req.json());
  const chat = await createChat(session.userId, payload.providerId, payload.title);
  return c.json({ chat }, 201);
});

chatRoutes.get('/:chatId/messages', async (c) => {
  const session = c.get('authSession');
  const chat = await getChatWithMessages(session.userId, c.req.param('chatId'));
  return c.json({ chat });
});

chatRoutes.post('/:chatId/messages', async (c) => {
  const session = c.get('authSession');
  const payload = createMessageSchema.parse(await c.req.json());
  const result = await createMessage({
    userId: session.userId,
    chatId: c.req.param('chatId'),
    content: payload.content,
    fileIds: payload.fileIds,
  });

  return c.json(result, 201);
});
