import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import type { AppVariables } from '../../types';
import {
  createChat,
  createMessage,
  deleteAsyncMessage,
  getChatWithMessages,
  listChats,
  retryAsyncMessage,
} from './chat-service';

const createChatSchema = z.object({
  providerId: z.string().min(1),
  title: z.string().trim().min(1).max(120).optional(),
});

const createMessageSchema = z.object({
  content: z.string().min(1).max(12000),
  fileIds: z.array(z.string().min(1)).max(5).optional(),
});

const messagesQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  cursor: z.string().min(1).optional(),
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
  const chat = await createChat(
    session.userId,
    payload.providerId,
    payload.title,
  );
  return c.json({ chat }, 201);
});

chatRoutes.get('/:chatId/messages', async (c) => {
  const session = c.get('authSession');
  const query = messagesQuerySchema.parse({
    limit: c.req.query('limit'),
    cursor: c.req.query('cursor'),
  });
  const chat = await getChatWithMessages(
    session.userId,
    c.req.param('chatId'),
    query,
  );
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

chatRoutes.post('/:chatId/messages/:messageId/retry', async (c) => {
  const session = c.get('authSession');
  const result = await retryAsyncMessage({
    userId: session.userId,
    chatId: c.req.param('chatId'),
    messageId: c.req.param('messageId'),
  });

  return c.json(result, 200);
});

chatRoutes.delete('/:chatId/messages/:messageId', async (c) => {
  const session = c.get('authSession');
  await deleteAsyncMessage({
    userId: session.userId,
    chatId: c.req.param('chatId'),
    messageId: c.req.param('messageId'),
  });

  return c.json({ deleted: true }, 200);
});
