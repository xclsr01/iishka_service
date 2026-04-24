import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { GenerationJobKind, ProviderKey } from '@prisma/client';
import { env } from '../../env';
import { VeoProviderAdapter } from './veo-provider';
import { ProviderAdapterError } from './provider-types';

const originalFetch = globalThis.fetch;
const originalAiGatewayUrl = env.AI_GATEWAY_URL;
const originalAiGatewayToken = env.AI_GATEWAY_INTERNAL_TOKEN;

afterEach(() => {
  globalThis.fetch = originalFetch;
  env.AI_GATEWAY_URL = originalAiGatewayUrl;
  env.AI_GATEWAY_INTERNAL_TOKEN = originalAiGatewayToken;
});

test('VeoProviderAdapter starts polls and downloads videos through the Gemini API', async () => {
  const adapter = new VeoProviderAdapter();
  const calledUrls: string[] = [];
  const calledMethods: string[] = [];
  const calledBodies: Array<Record<string, unknown> | null> = [];

  env.AI_GATEWAY_URL = undefined;
  env.AI_GATEWAY_INTERNAL_TOKEN = undefined;

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calledUrls.push(url);
    calledMethods.push(init?.method ?? 'GET');
    calledBodies.push(init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null);

    if (url.endsWith(':predictLongRunning')) {
      return new Response(
        JSON.stringify({
          name: 'operations/veo-operation-1',
          done: false,
        }),
        {
          status: 200,
          headers: {
            'x-request-id': 'req_veo_start',
          },
        },
      );
    }

    if (url.endsWith('/operations/veo-operation-1')) {
      return new Response(
        JSON.stringify({
          name: 'operations/veo-operation-1',
          done: true,
          response: {
            generateVideoResponse: {
              generatedSamples: [
                {
                  video: {
                    uri: 'https://video-download.example.com/veo.mp4',
                    mimeType: 'video/mp4',
                  },
                },
              ],
            },
          },
        }),
        { status: 200 },
      );
    }

    if (url === 'https://video-download.example.com/veo.mp4') {
      return new Response(Buffer.from('video-bytes'), {
        status: 200,
        headers: {
          'content-type': 'video/mp4',
        },
      });
    }

    throw new Error(`Unexpected URL: ${url}`);
  };

  const result = await adapter.executeAsyncJob({
    providerKey: ProviderKey.VEO,
    jobId: 'job_veo',
    kind: GenerationJobKind.VIDEO,
    model: 'veo-3.1-fast-generate-preview',
    prompt: 'A cinematic dolly shot of neon rain over a city street.',
  });

  assert.equal(
    calledUrls[0],
    'https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-fast-generate-preview:predictLongRunning',
  );
  assert.equal(calledMethods[0], 'POST');
  assert.deepEqual(calledBodies[0], {
    instances: [
      {
        prompt: 'A cinematic dolly shot of neon rain over a city street.',
      },
    ],
    parameters: {
      aspectRatio: '16:9',
      durationSeconds: 4,
      resolution: '720p',
      personGeneration: 'allow_all',
    },
  });
  assert.equal(
    calledUrls[1],
    'https://generativelanguage.googleapis.com/v1beta/operations/veo-operation-1',
  );
  assert.equal(calledMethods[1], 'GET');
  assert.equal(calledUrls[2], 'https://video-download.example.com/veo.mp4');
  assert.equal(result.upstreamRequestId, 'req_veo_start');
  assert.equal(result.externalJobId, 'operations/veo-operation-1');
  assert.deepEqual(result.resultPayload, {
    kind: GenerationJobKind.VIDEO,
    text: null,
    videos: [
      {
        index: 0,
        mimeType: 'video/mp4',
        filename: 'veo-job_veo-0.mp4',
        sizeBytes: 11,
        metadata: {
          aspectRatio: '16:9',
          durationSeconds: 4,
          resolution: '720p',
        },
      },
    ],
  });
  assert.equal(result.artifacts?.length, 1);
  assert.equal(result.artifacts?.[0]?.role, 'video');
  assert.equal(result.artifacts?.[0]?.filename, 'veo-job_veo-0.mp4');
  assert.equal(result.artifacts?.[0]?.mimeType, 'video/mp4');
  assert.equal(result.artifacts?.[0]?.sizeBytes, 11);
});

test('VeoProviderAdapter executes video jobs through configured AI gateway', async () => {
  const adapter = new VeoProviderAdapter();
  let calledUrl = '';
  let calledHeaders: Record<string, string> = {};
  let calledPayload: {
    kind: string;
    model: string;
    prompt: string;
    jobId: string;
  } | null = null;

  env.AI_GATEWAY_URL = 'https://ai-gateway.example.run.app';
  env.AI_GATEWAY_INTERNAL_TOKEN = 'test-ai-gateway-token-000000000000000000';

  globalThis.fetch = async (input, init) => {
    calledUrl = String(input);
    calledHeaders = init?.headers as Record<string, string>;
    calledPayload = JSON.parse(String(init?.body));

    return new Response(
      JSON.stringify({
        provider: 'veo',
        model: 'veo-3.1-fast-generate-preview',
        resultPayload: {
          kind: GenerationJobKind.VIDEO,
          text: null,
          videos: [
            {
              index: 0,
              mimeType: 'video/mp4',
              filename: 'veo-job_veo-0.mp4',
              sizeBytes: 11,
              metadata: {
                aspectRatio: '16:9',
                durationSeconds: 4,
                resolution: '720p',
              },
            },
          ],
        },
        artifacts: [
          {
            kind: 'file',
            role: 'video',
            filename: 'veo-job_veo-0.mp4',
            mimeType: 'video/mp4',
            dataBase64: Buffer.from('video-bytes').toString('base64'),
            sizeBytes: 11,
            metadata: {
              aspectRatio: '16:9',
              durationSeconds: 4,
              resolution: '720p',
            },
          },
        ],
        upstreamRequestId: 'req_gateway_veo',
        externalJobId: 'operations/veo-operation-1',
        usage: null,
      }),
      { status: 200 },
    );
  };

  const result = await adapter.executeAsyncJob({
    providerKey: ProviderKey.VEO,
    jobId: 'job_veo',
    kind: GenerationJobKind.VIDEO,
    model: 'veo-3.1-fast-generate-preview',
    prompt: 'Generate a short noir tracking shot.',
  });

  assert.equal(calledUrl, 'https://ai-gateway.example.run.app/v1/providers/veo/jobs/execute');
  assert.equal(calledHeaders.authorization, 'Bearer test-ai-gateway-token-000000000000000000');
  assert.ok(calledPayload);
  assert.equal(calledPayload.kind, GenerationJobKind.VIDEO);
  assert.equal(calledPayload.model, 'veo-3.1-fast-generate-preview');
  assert.equal(calledPayload.prompt, 'Generate a short noir tracking shot.');
  assert.equal(calledPayload.jobId, 'job_veo');
  assert.equal(result.upstreamRequestId, 'req_gateway_veo');
  assert.equal(result.externalJobId, 'operations/veo-operation-1');
  assert.equal(result.artifacts?.[0]?.sizeBytes, 11);
});

test('VeoProviderAdapter accepts generatedVideos response shape from Gemini API', async () => {
  const adapter = new VeoProviderAdapter();

  env.AI_GATEWAY_URL = undefined;
  env.AI_GATEWAY_INTERNAL_TOKEN = undefined;

  globalThis.fetch = async (input) => {
    const url = String(input);

    if (url.endsWith(':predictLongRunning')) {
      return new Response(
        JSON.stringify({
          name: 'operations/veo-operation-modern',
          done: false,
        }),
        { status: 200 },
      );
    }

    if (url.endsWith('/operations/veo-operation-modern')) {
      return new Response(
        JSON.stringify({
          name: 'operations/veo-operation-modern',
          done: true,
          response: {
            generatedVideos: [
              {
                video: {
                  uri: 'https://video-download.example.com/veo-modern.mp4',
                  mimeType: 'video/mp4',
                },
              },
            ],
          },
        }),
        { status: 200 },
      );
    }

    if (url === 'https://video-download.example.com/veo-modern.mp4') {
      return new Response(Buffer.from('video-bytes'), {
        status: 200,
        headers: {
          'content-type': 'video/mp4',
        },
      });
    }

    throw new Error(`Unexpected URL: ${url}`);
  };

  const result = await adapter.executeAsyncJob({
    providerKey: ProviderKey.VEO,
    jobId: 'job_veo_modern',
    kind: GenerationJobKind.VIDEO,
    model: 'veo-3.1-fast-generate-preview',
    prompt: 'A modern Veo response payload test.',
  });

  assert.equal(result.externalJobId, 'operations/veo-operation-modern');
  assert.equal(result.artifacts?.[0]?.filename, 'veo-job_veo_modern-0.mp4');
  assert.equal(result.artifacts?.[0]?.mimeType, 'video/mp4');
});

test('VeoProviderAdapter rejects non-video job kinds', async () => {
  const adapter = new VeoProviderAdapter();

  env.AI_GATEWAY_URL = undefined;
  env.AI_GATEWAY_INTERNAL_TOKEN = undefined;

  await assert.rejects(
    () =>
      adapter.executeAsyncJob({
        providerKey: ProviderKey.VEO,
        jobId: 'job_veo',
        kind: GenerationJobKind.IMAGE,
        model: 'veo-3.1-fast-generate-preview',
        prompt: 'Hello',
      }),
    /only supports video generation jobs/,
  );
});

test('VeoProviderAdapter classifies retryable rate limit errors', async () => {
  const adapter = new VeoProviderAdapter();

  env.AI_GATEWAY_URL = undefined;
  env.AI_GATEWAY_INTERNAL_TOKEN = undefined;

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: {
          code: 429,
          message: 'Quota exceeded',
          status: 'RESOURCE_EXHAUSTED',
        },
      }),
      { status: 429 },
    );

  await assert.rejects(
    () =>
      adapter.executeAsyncJob({
        providerKey: ProviderKey.VEO,
        jobId: 'job_veo',
        kind: GenerationJobKind.VIDEO,
        model: 'veo-3.1-fast-generate-preview',
        prompt: 'Hello',
      }),
    (error) => {
      assert.ok(error instanceof ProviderAdapterError);
      assert.equal(error.code, 'PROVIDER_RATE_LIMITED');
      assert.equal(error.category, 'rate_limit');
      assert.equal(error.retryable, true);
      assert.equal(error.upstreamStatus, 429);
      return true;
    },
  );
});
