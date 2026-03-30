import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

try {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const backendDir = path.resolve(currentDir, '..');
  const repoRootDir = path.resolve(backendDir, '..');

  // Load root env first for shared defaults, then backend/.env to allow backend-specific overrides.
  dotenv.config({ path: path.join(repoRootDir, '.env') });
  dotenv.config({ path: path.join(backendDir, '.env'), override: true });
} catch {
  // Local env files are optional in development, so loading them should never block startup.
}
