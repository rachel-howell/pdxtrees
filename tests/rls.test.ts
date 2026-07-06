/**
 * Live privacy-boundary smoke tests: anonymous, READ-ONLY requests against the
 * real Supabase project (the one write attempt asserts it is rejected).
 * RLS is the app's actual security boundary — mocks cannot verify it.
 *
 * Run with `npm run test:rls` (needs network; not part of the default suite).
 * If the free-tier project is paused after idle, the suite skips with a warning
 * instead of failing — unpause it in the Supabase dashboard.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

// Keep in sync with src/supabase.ts (both values are committed by design).
const SUPABASE_URL = 'https://qbjpcrubwbxywbuppfuq.supabase.co';
const ANON_KEY = 'sb_publishable_EkEM1O88KeHpNsSEZLk1Gw_bQIsCerP';

const HEADERS = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };

function anonFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: { ...HEADERS, ...init.headers },
    signal: AbortSignal.timeout(10_000),
  });
}

const reachable = await (async () => {
  try {
    // Any HTTP response (even 401) proves the project is up; only network
    // failure/timeout means unreachable (likely paused free tier).
    await fetch(`${SUPABASE_URL}/rest/v1/`, { headers: HEADERS, signal: AbortSignal.timeout(5_000) });
    return true;
  } catch {
    return false;
  }
})();

if (!reachable) {
  console.warn(
    `\nSupabase project unreachable — it may be paused after idle (free tier).` +
      `\nUnpause it in the dashboard, then re-run npm run test:rls. Skipping suite.\n`,
  );
}

describe.skipIf(!reachable)('RLS privacy boundary (anon)', () => {
  it('views table is invisible to anon (no grant — window photos reveal the viewpoint)', async () => {
    const res = await anonFetch('/rest/v1/views?select=id');
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('view_markers table is invisible to anon', async () => {
    const res = await anonFetch('/rest/v1/view_markers?select=id');
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('profiles leak nothing to anon', async () => {
    const res = await anonFetch('/rest/v1/profiles?select=*');
    if (res.status === 200) {
      expect(await res.json()).toEqual([]);
    } else {
      expect(res.status).toBeGreaterThanOrEqual(400);
    }
  });

  it('anon cannot insert a tree', async () => {
    const id = randomUUID();
    const res = await anonFetch('/rest/v1/trees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        id,
        lat: 0,
        lng: 0,
        common_name: 'rls-test-should-never-exist',
        nickname: '',
        species: '',
        date_encountered: '2026-01-01',
        notes: '',
        confidence: 'low',
        status: 'spotted',
        location_label: '',
        is_public: true,
      }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);

    const check = await anonFetch(`/rest/v1/trees?select=id&id=eq.${id}`);
    expect(check.status).toBe(200);
    expect(await check.json()).toEqual([]); // nothing was created
  });

  it('every tree visible to anon is explicitly public', async () => {
    const res = await anonFetch('/rest/v1/trees?select=id,is_public');
    expect(res.status).toBe(200);
    const trees = (await res.json()) as { id: string; is_public: boolean }[];
    for (const tree of trees) {
      expect(tree.is_public, `tree ${tree.id} leaked to anon without is_public`).toBe(true);
    }
  });

  it('a nonexistent tree and a hidden tree are indistinguishable (empty result)', async () => {
    const res = await anonFetch(`/rest/v1/trees?select=*&id=eq.${randomUUID()}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('view images are unreachable through the storage API', async () => {
    const path = `tree-photos/${randomUUID()}/views/${randomUUID()}.jpg`;
    const direct = await anonFetch(`/storage/v1/object/${path}`);
    expect(direct.status).toBeGreaterThanOrEqual(400);
    const publicUrl = await anonFetch(`/storage/v1/object/public/${path}`);
    expect(publicUrl.status).toBeGreaterThanOrEqual(400);
  });
});
