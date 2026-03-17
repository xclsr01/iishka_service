import { AppError } from '../../lib/errors';
import { env } from '../../env';
import type { AiProviderAdapter, ProviderGenerateInput } from './provider-types';

export class OpenAiProviderAdapter implements AiProviderAdapter {
  async generateResponse(input: ProviderGenerateInput) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: input.model || env.OPENAI_MODEL,
        messages: input.messages,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new AppError(
        `OpenAI request failed${body ? `: ${body}` : ''}`,
        502,
        'PROVIDER_REQUEST_FAILED',
      );
    }

    const data = (await response.json()) as {
      id: string;
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
      usage?: Record<string, unknown>;
    };

    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) {
      throw new AppError('OpenAI returned empty content', 502, 'PROVIDER_EMPTY_RESPONSE');
    }

    return {
      text,
      raw: {
        id: data.id,
        usage: data.usage ?? null,
      },
    };
  }
}
