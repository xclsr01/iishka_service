import {
  IdempotencyAction,
  IdempotencyRequestStatus,
  Prisma,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { AppError } from './errors';
import { prisma } from './prisma';

const IDEMPOTENCY_WAIT_ATTEMPTS = 220;
const IDEMPOTENCY_WAIT_MS = 100;

type IdempotentOperationInput<T> = {
  userId: string;
  action: IdempotencyAction;
  key?: string | null;
  requestPayload: unknown;
  operation: () => Promise<T>;
  resource: (result: T) => {
    resourceType: string;
    resourceId: string;
  };
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stableJsonStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(',')}]`;
  }

  const objectValue = value as Record<string, unknown>;
  return `{${Object.keys(objectValue)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(objectValue[key])}`)
    .join(',')}}`;
}

function hashRequestPayload(payload: unknown) {
  return createHash('sha256')
    .update(stableJsonStringify(payload))
    .digest('hex');
}

function toJsonValue<T>(result: T) {
  return JSON.parse(JSON.stringify(result)) as T;
}

async function waitForCompletedResponse<T>(input: {
  userId: string;
  action: IdempotencyAction;
  key: string;
  requestHash: string;
}) {
  for (let attempt = 0; attempt < IDEMPOTENCY_WAIT_ATTEMPTS; attempt += 1) {
    const record = await prisma.idempotencyKey.findUnique({
      where: {
        userId_action_key: {
          userId: input.userId,
          action: input.action,
          key: input.key,
        },
      },
    });

    if (!record) {
      throw new AppError(
        'Idempotency key is not available',
        409,
        'IDEMPOTENCY_KEY_IN_PROGRESS',
      );
    }

    if (record.requestHash !== input.requestHash) {
      throw new AppError(
        'Idempotency key was already used for a different request',
        409,
        'IDEMPOTENCY_KEY_CONFLICT',
      );
    }

    if (
      record.status === IdempotencyRequestStatus.COMPLETED &&
      record.response !== null
    ) {
      return record.response as T;
    }

    await sleep(IDEMPOTENCY_WAIT_MS);
  }

  throw new AppError(
    'Request is still processing',
    409,
    'IDEMPOTENCY_KEY_IN_PROGRESS',
  );
}

export async function runIdempotentOperation<T>(
  input: IdempotentOperationInput<T>,
) {
  const key = input.key?.trim();
  if (!key) {
    return input.operation();
  }

  const requestHash = hashRequestPayload(input.requestPayload);

  const createResult = await prisma.idempotencyKey.createMany({
    data: {
      userId: input.userId,
      action: input.action,
      key,
      requestHash,
    },
    skipDuplicates: true,
  });

  if (createResult.count === 0) {
    return waitForCompletedResponse<T>({
      userId: input.userId,
      action: input.action,
      key,
      requestHash,
    });
  }

  try {
    const result = await input.operation();
    const jsonResult = toJsonValue(result);
    const resource = input.resource(result);

    await prisma.idempotencyKey.update({
      where: {
        userId_action_key: {
          userId: input.userId,
          action: input.action,
          key,
        },
      },
      data: {
        status: IdempotencyRequestStatus.COMPLETED,
        resourceType: resource.resourceType,
        resourceId: resource.resourceId,
        response: jsonResult as Prisma.InputJsonValue,
      },
    });

    return result;
  } catch (error) {
    await prisma.idempotencyKey
      .delete({
        where: {
          userId_action_key: {
            userId: input.userId,
            action: input.action,
            key,
          },
        },
      })
      .catch(() => undefined);
    throw error;
  }
}
