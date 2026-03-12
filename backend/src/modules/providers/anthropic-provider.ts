import { AppError } from '../../lib/errors';
import { env } from '../../env';
import type { AiProviderAdapter, ProviderGenerateInput } from './provider-types';

export class AnthropicProviderAdapter implements AiProviderAdapter {
  async generateResponse(input: ProviderGenerateInput) {
    const system = input.messages.find((message) => message.role === 'system')?.content;
    const messages = input.messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({
        role: message.role,
        content: message.content,
      }));

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: input.model || env.ANTHROPIC_MODEL,
        max_tokens: 1024,
        system,
        messages,
      }),
    });

    if (!response.ok) {
      throw new AppError('Anthropic request failed', 502, 'PROVIDER_REQUEST_FAILED');
    }

    const data = (await response.json()) as {
      id: string;
      content?: Array<{
        type: string;
        text?: string;
      }>;
      usage?: Record<string, unknown>;
    };

    const text = data.content?.find((item) => item.type === 'text')?.text?.trim();
    if (!text) {
      throw new AppError('Anthropic returned empty content', 502, 'PROVIDER_EMPTY_RESPONSE');
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
