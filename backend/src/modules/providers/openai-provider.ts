import { AppError } from '../../lib/errors';
import { env } from '../../env';
import type { AiProviderAdapter, ProviderGenerateInput } from './provider-types';

export class OpenAiProviderAdapter implements AiProviderAdapter {
  async generateResponse(input: ProviderGenerateInput) {
    if (!env.OPENAI_ENABLED) {
      throw new AppError(
        'ChatGPT is temporarily unavailable in this deployment region. Use Claude or Gemini, or route OpenAI through a separate proxy/server in a supported region.',
        503,
        'PROVIDER_REGION_UNAVAILABLE',
      );
    }

    let response: Response;
    try {
      response = await fetch(`${env.OPENAI_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: input.model || env.OPENAI_MODEL,
          messages: input.messages,
        }),
        signal: AbortSignal.timeout(15000),
      });
    } catch (error) {
      throw new AppError(
        `OpenAI network request failed: ${error instanceof Error ? error.message : 'unknown'}`,
        502,
        'PROVIDER_REQUEST_FAILED',
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');

      if (body.includes('unsupported_country_region_territory')) {
        throw new AppError(
          'ChatGPT is temporarily unavailable in this deployment region. Use Claude or Gemini, or route OpenAI through a separate proxy/server in a supported region.',
          503,
          'PROVIDER_REGION_UNAVAILABLE',
        );
      }

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
