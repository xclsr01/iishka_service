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
  const user = c.get('currentUser');
  const chats = await listChats(user.id);
  return c.json({ chats });
});

chatRoutes.post('/', async (c) => {
  const user = c.get('currentUser');
  const payload = createChatSchema.parse(await c.req.json());
  const chat = await createChat(user.id, payload.providerId, payload.title);
  return c.json({ chat }, 201);
});

chatRoutes.get('/:chatId/messages', async (c) => {
  const user = c.get('currentUser');
  const chat = await getChatWithMessages(user.id, c.req.param('chatId'));
  return c.json({ chat });
});

chatRoutes.post('/:chatId/messages', async (c) => {
  const user = c.get('currentUser');
  const payload = createMessageSchema.parse(await c.req.json());
  const result = await createMessage({
    userId: user.id,
    chatId: c.req.param('chatId'),
    content: payload.content,
    fileIds: payload.fileIds,
  });

  return c.json(result, 201);
});
