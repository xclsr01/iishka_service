import { AppError } from '../../lib/errors';
import { env } from '../../env';
import type { AiProviderAdapter, ProviderGenerateInput } from './provider-types';

export class GeminiProviderAdapter implements AiProviderAdapter {
  async generateResponse(input: ProviderGenerateInput) {
    const prompt = input.messages
      .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
      .join('\n\n');

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${
        input.model || env.GOOGLE_AI_MODEL
      }:generateContent?key=${env.GOOGLE_AI_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: prompt,
                },
              ],
            },
          ],
        }),
      },
    );

    if (!response.ok) {
      throw new AppError('Gemini request failed', 502, 'PROVIDER_REQUEST_FAILED');
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
      usageMetadata?: Record<string, unknown>;
    };

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) {
      throw new AppError('Gemini returned empty content', 502, 'PROVIDER_EMPTY_RESPONSE');
    }

    return {
      text,
      raw: {
        usage: data.usageMetadata ?? null,
      },
    };
  }
}
