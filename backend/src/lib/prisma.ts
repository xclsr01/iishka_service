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

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma =
  globalThis.__prisma ??
  new PrismaClient({
    adapter: createAdapter(),
    log: ['warn', 'error'],
  });

if (process.env.APP_ENV !== 'production') {
  globalThis.__prisma = prisma;
}
