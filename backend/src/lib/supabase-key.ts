export type SupabaseJwtInspection =
  | {
      valid: true;
      role: string | null;
      ref: string | null;
    }
  | {
      valid: false;
      reason: string;
    };

function decodeBase64UrlJson(segment: string): unknown {
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
}

function getStringClaim(payload: unknown, claim: string) {
  if (!payload || typeof payload !== 'object' || !(claim in payload)) {
    return null;
  }

  const value = (payload as Record<string, unknown>)[claim];
  return typeof value === 'string' ? value : null;
}

export function inspectSupabaseJwtKey(key: string): SupabaseJwtInspection {
  const segments = key.split('.');
  if (segments.length !== 3) {
    return { valid: false, reason: 'key is not a JWT' };
  }

  try {
    const payload = decodeBase64UrlJson(segments[1]);
    return {
      valid: true,
      role: getStringClaim(payload, 'role'),
      ref: getStringClaim(payload, 'ref'),
    };
  } catch {
    return { valid: false, reason: 'key payload is not valid base64url JSON' };
  }
}

export function getSupabaseProjectRef(url: string) {
  const hostname = new URL(url).hostname;
  const suffix = '.supabase.co';
  if (!hostname.endsWith(suffix)) {
    return null;
  }

  const projectRef = hostname.slice(0, -suffix.length);
  return projectRef || null;
}

export function validateSupabaseServiceRoleKey(input: {
  key: string;
  supabaseUrl: string;
}): string | null {
  if (input.key.startsWith('sb_secret_')) {
    return null;
  }

  const inspection = inspectSupabaseJwtKey(input.key);
  if (!inspection.valid) {
    return `SUPABASE_SERVICE_ROLE_KEY must be a Supabase secret key or legacy service_role JWT: ${inspection.reason}`;
  }

  if (inspection.role !== 'service_role') {
    const role = inspection.role ?? 'missing';
    return `SUPABASE_SERVICE_ROLE_KEY must be a Supabase secret key or legacy service_role JWT, but received JWT role "${role}"`;
  }

  const projectRef = getSupabaseProjectRef(input.supabaseUrl);
  if (projectRef && inspection.ref && inspection.ref !== projectRef) {
    return 'SUPABASE_SERVICE_ROLE_KEY belongs to a different Supabase project than SUPABASE_URL';
  }

  return null;
}
