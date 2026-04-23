import { z } from 'zod';

export const providerKeySchema = z.enum(['openai', 'anthropic', 'gemini', 'nano-banana', 'veo']);

export const gatewayMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string().trim().min(1).max(12000),
});

export const chatRespondRequestSchema = z.object({
  model: z.string().trim().min(1).optional(),
  messages: z.array(gatewayMessageSchema).min(1).max(200),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().int().positive().max(32000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  requestId: z.string().min(1).max(128).optional(),
  userId: z.string().min(1).max(128).optional(),
  chatId: z.string().min(1).max(128).optional(),
});

export const asyncJobRequestSchema = z.object({
  kind: z.enum(['IMAGE', 'MUSIC', 'VIDEO', 'PROVIDER_ASYNC']),
  model: z.string().trim().min(1).optional(),
  prompt: z.string().trim().min(1).max(12000),
  jobId: z.string().min(1).max(128).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  requestId: z.string().min(1).max(128).optional(),
  userId: z.string().min(1).max(128).optional(),
  chatId: z.string().min(1).max(128).optional(),
});
