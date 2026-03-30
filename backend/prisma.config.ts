import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { defineConfig } from 'prisma/config';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(currentDir, '../.env') });
dotenv.config({ path: path.resolve(currentDir, '.env'), override: true });

function resolveDatasourceUrl() {
  const migrationUrl = process.env.MIGRATION_DATABASE_URL?.trim();
  const directUrl = process.env.DIRECT_URL?.trim();
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const resolvedUrl = migrationUrl || directUrl || databaseUrl || '';

  if (!resolvedUrl) {
    return '';
  }

  // Keep Prisma CLI aligned with the resolved datasource URL instead of whatever is in schema.prisma.
  process.env.DATABASE_URL = resolvedUrl;

  const isMigrateCommand = process.argv.some((arg) => arg.includes('migrate'));
  const isSupabasePooler = resolvedUrl.includes('pooler.supabase.com:6543');

  if (isMigrateCommand && isSupabasePooler) {
    throw new Error(
      'Prisma migrations are using the Supabase pooler URL. Set DIRECT_URL or MIGRATION_DATABASE_URL to the direct 5432 connection before running migrate commands.',
    );
  }

  return resolvedUrl;
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: resolveDatasourceUrl(),
  },
});
