import { spawnSync } from 'node:child_process';

const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
