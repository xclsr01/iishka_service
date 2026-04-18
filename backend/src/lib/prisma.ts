import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { env } from '../env';

function createAdapter() {
  const databaseUrl = new URL(env.DATABASE_URL);
  const schema = databaseUrl.searchParams.get('schema') ?? undefined;
  databaseUrl.searchParams.delete('schema');

  return new PrismaPg(
    {
      connectionString: databaseUrl.toString(),
    },
    schema
      ? {
          schema,
        }
      : undefined,
  );
}

function createPrismaClient() {
  return new PrismaClient({
    adapter: createAdapter(),
    log: ['warn', 'error'],
  });
}

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export let prisma = globalThis.__prisma ?? createPrismaClient();

if (process.env.APP_ENV !== 'production') {
  globalThis.__prisma = prisma;
}

let activePrismaScopes = 0;
let disconnectRequested = false;
let disconnectPromise: Promise<void> | null = null;

async function rotatePrismaClient() {
  const client = prisma;
  await client.$disconnect();

  if (prisma !== client) {
    return;
  }

  prisma = createPrismaClient();

  if (process.env.APP_ENV !== 'production') {
    globalThis.__prisma = prisma;
  }
}

export async function ensurePrismaReady() {
  if (disconnectPromise) {
    await disconnectPromise;
  }
}

export function retainPrisma() {
  activePrismaScopes += 1;
  let released = false;

  return async () => {
    if (released) {
      return;
    }

    released = true;
    activePrismaScopes = Math.max(0, activePrismaScopes - 1);

    return;
  };
}

export async function disconnectPrisma() {
  if (activePrismaScopes > 0) {
    disconnectRequested = true;
    return;
  }

  if (disconnectPromise) {
    await disconnectPromise;
    return;
  }

  disconnectRequested = false;
  disconnectPromise = rotatePrismaClient().finally(() => {
    disconnectPromise = null;
  });

  await disconnectPromise;
}
