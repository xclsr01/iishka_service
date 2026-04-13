import { z } from 'zod';

export const chatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string().trim().min(1).max(12000),
});

export const chatRespondRequestSchema = z.object({
  model: z.string().trim().min(1),
  messages: z.array(chatMessageSchema).min(1).max(200),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().int().positive().max(32000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  requestId: z.string().min(1).max(128).optional(),
  userId: z.string().min(1).max(128).optional(),
  chatId: z.string().min(1).max(128).optional(),
});
