import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getSupabaseProjectRef,
  inspectSupabaseJwtKey,
  validateSupabaseServiceRoleKey,
} from './supabase-key';

function unsignedJwt(payload: Record<string, unknown>) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.signature`;
}

describe('supabase key validation', () => {
  it('extracts the Supabase project ref from standard Supabase URLs', () => {
    assert.equal(getSupabaseProjectRef('https://pehujciaiihjuzduysln.supabase.co'), 'pehujciaiihjuzduysln');
    assert.equal(getSupabaseProjectRef('https://storage.example.com'), null);
  });

  it('detects anon keys before storage upload attempts', () => {
    const anonKey = unsignedJwt({ role: 'anon', ref: 'pehujciaiihjuzduysln' });

    assert.equal(inspectSupabaseJwtKey(anonKey).valid, true);
    assert.match(
      validateSupabaseServiceRoleKey({
        key: anonKey,
        supabaseUrl: 'https://pehujciaiihjuzduysln.supabase.co',
      }) ?? '',
      /must be a Supabase secret key or legacy service_role JWT/,
    );
  });

  it('accepts a new Supabase secret key', () => {
    assert.equal(
      validateSupabaseServiceRoleKey({
        key: 'sb_secret_example_secret_key_value',
        supabaseUrl: 'https://pehujciaiihjuzduysln.supabase.co',
      }),
      null,
    );
  });

  it('accepts a matching service role key', () => {
    const serviceRoleKey = unsignedJwt({ role: 'service_role', ref: 'pehujciaiihjuzduysln' });

    assert.equal(
      validateSupabaseServiceRoleKey({
        key: serviceRoleKey,
        supabaseUrl: 'https://pehujciaiihjuzduysln.supabase.co',
      }),
      null,
    );
  });

  it('rejects a service role key from another Supabase project', () => {
    const serviceRoleKey = unsignedJwt({ role: 'service_role', ref: 'anotherprojectref' });

    assert.match(
      validateSupabaseServiceRoleKey({
        key: serviceRoleKey,
        supabaseUrl: 'https://pehujciaiihjuzduysln.supabase.co',
      }) ?? '',
      /different Supabase project/,
    );
  });
});
