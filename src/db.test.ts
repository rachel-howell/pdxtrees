import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', async () => ({ supabase: (await import('./test/mocks')).supabaseMock }));
vi.mock('./auth', async () => ({ currentUserId: (await import('./test/mocks')).currentUserIdMock }));

import {
  addMarker,
  addPhoto,
  createTree,
  createView,
  deletePhoto,
  deleteTree,
  deleteView,
  displayName,
  getAccountPrivate,
  getPhotos,
  getTree,
  getViewImage,
  importRecords,
  listMarkers,
  listTrees,
  listViews,
  updateTree,
  type Tree,
} from './db';
import { FAKE_UID, failNext, resetMock, rows, state } from './test/mocks';

// All names, coordinates, and labels below are invented — never real data.
function treeInput(overrides: Partial<Omit<Tree, 'id' | 'createdAt' | 'updatedAt'>> = {}) {
  return {
    lat: 45.52,
    lng: -122.68,
    commonName: 'Douglas fir',
    nickname: 'The Tall One',
    species: 'Pseudotsuga menziesii',
    dateEncountered: '2026-07-01',
    notes: 'identified by cone shape',
    confidence: 'medium' as const,
    status: 'guessed' as const,
    locationLabel: 'SW Park Ave & SW Salmon St',
    isPublic: false,
    ...overrides,
  };
}

beforeEach(() => resetMock());

describe('tree row mapping', () => {
  it('round-trips every field through createTree → listTrees', async () => {
    const input = treeInput();
    const created = await createTree(input);
    const [listed] = await listTrees();
    expect(listed).toEqual({
      ...input,
      id: created.id,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    });
  });

  it('stores snake_case columns (no camelCase leaks into rows)', async () => {
    await createTree(treeInput());
    const row = rows('trees')[0];
    for (const col of [
      'common_name',
      'nickname',
      'species',
      'date_encountered',
      'notes',
      'confidence',
      'status',
      'location_label',
      'lat',
      'lng',
      'is_public',
    ]) {
      expect(row, `missing column ${col}`).toHaveProperty(col);
    }
    expect(row).not.toHaveProperty('commonName');
    expect(row).not.toHaveProperty('isPublic');
  });

  it('partial updates do not clobber other fields', async () => {
    const created = await createTree(treeInput());
    await updateTree(created.id, { isPublic: true });
    const after = await getTree(created.id);
    expect(after).toMatchObject({ ...treeInput(), isPublic: true });
  });

  it('getTree returns null for an unknown id (same as a hidden one)', async () => {
    await createTree(treeInput());
    expect(await getTree('00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});

describe('displayName', () => {
  it('prefers nickname, then common name, then the fallback', () => {
    expect(displayName({ nickname: 'Stumpy', commonName: 'Red maple' })).toBe('Stumpy');
    expect(displayName({ nickname: '', commonName: 'Red maple' })).toBe('Red maple');
    expect(displayName({ nickname: '', commonName: '' })).toBe('Unidentified tree');
  });
});

describe('auth guards', () => {
  it('mutations throw when logged out', async () => {
    resetMock(null);
    const blob = new Blob(['x'], { type: 'image/jpeg' });
    await expect(createTree(treeInput())).rejects.toThrow(/logged in/);
    await expect(addPhoto('some-tree', blob)).rejects.toThrow(/logged in/);
    await expect(createView('My window', blob)).rejects.toThrow(/logged in/);
    await expect(deleteTree('some-tree')).rejects.toThrow(/logged in/);
    await expect(importRecords([], [])).rejects.toThrow(/logged in/);
    await expect(getAccountPrivate()).rejects.toThrow(/logged in/);
  });
});

describe('photo storage paths (privacy-load-bearing)', () => {
  it('uploads tree photos to exactly {uid}/{treeId}/{photoId}.jpg', async () => {
    const tree = await createTree(treeInput());
    const photo = await addPhoto(tree.id, new Blob(['img'], { type: 'image/jpeg' }));
    expect(state.uploads).toEqual([`${FAKE_UID}/${tree.id}/${photo.id}.jpg`]);
  });

  it('uploads view images under the literal views/ segment, unmatchable by the public-read policy', async () => {
    const view = await createView('From the desk', new Blob(['img'], { type: 'image/jpeg' }));
    expect(state.uploads).toEqual([`${FAKE_UID}/views/${view.id}.jpg`]);
  });

  it('downloads photos from the owner path recorded on the row', async () => {
    const tree = await createTree(treeInput());
    const photo = await addPhoto(tree.id, new Blob(['img'], { type: 'image/jpeg' }));
    const photos = await getPhotos(tree.id);
    expect(photos).toHaveLength(1);
    expect(photos[0].id).toBe(photo.id);
    expect(state.downloads).toEqual([`${FAKE_UID}/${tree.id}/${photo.id}.jpg`]);
  });
});

describe('rollback on partial failure', () => {
  it('addPhoto removes the uploaded object when the row insert fails', async () => {
    const tree = await createTree(treeInput());
    failNext('photos', 'insert');
    await expect(addPhoto(tree.id, new Blob(['img']))).rejects.toThrow();
    expect(state.uploads).toHaveLength(1);
    expect(state.removals).toEqual(state.uploads);
    expect(state.objects.size).toBe(0);
  });

  it('createView removes the uploaded image when the row insert fails', async () => {
    failNext('views', 'insert');
    await expect(createView('Kitchen window', new Blob(['img']))).rejects.toThrow();
    expect(state.uploads).toHaveLength(1);
    expect(state.removals).toEqual(state.uploads);
    expect(state.objects.size).toBe(0);
  });
});

describe('deletion leaves no orphans', () => {
  it('deleteTree removes every photo object and the tree row', async () => {
    const tree = await createTree(treeInput());
    const p1 = await addPhoto(tree.id, new Blob(['a']));
    const p2 = await addPhoto(tree.id, new Blob(['b']));
    await deleteTree(tree.id);
    expect(state.removals.sort()).toEqual(
      [`${FAKE_UID}/${tree.id}/${p1.id}.jpg`, `${FAKE_UID}/${tree.id}/${p2.id}.jpg`].sort(),
    );
    expect(state.objects.size).toBe(0);
    expect(rows('trees')).toHaveLength(0);
  });

  it('deletePhoto removes the storage object and the row', async () => {
    const tree = await createTree(treeInput());
    const photo = await addPhoto(tree.id, new Blob(['a']));
    await deletePhoto(photo.id);
    expect(state.removals).toEqual([`${FAKE_UID}/${tree.id}/${photo.id}.jpg`]);
    expect(rows('photos')).toHaveLength(0);
  });

  it('deleteView removes the image object and the row', async () => {
    const view = await createView('Balcony', new Blob(['img']));
    await deleteView(view.id);
    expect(state.removals).toEqual([`${FAKE_UID}/views/${view.id}.jpg`]);
    expect(rows('views')).toHaveLength(0);
  });
});

describe('window views and markers', () => {
  it('lists views ordered by creation and round-trips markers', async () => {
    const view = await createView('South window', new Blob(['img']));
    const listed = await listViews();
    expect(listed).toEqual([{ id: view.id, name: 'South window', createdAt: view.createdAt }]);

    const tree = await createTree(treeInput());
    const marker = await addMarker(view.id, tree.id, 0.25, 0.75);
    expect(await listMarkers(view.id)).toEqual([
      { id: marker.id, viewId: view.id, treeId: tree.id, x: 0.25, y: 0.75 },
    ]);
  });

  it('getViewImage downloads from the owner-scoped views path', async () => {
    const view = await createView('North window', new Blob(['img'], { type: 'image/jpeg' }));
    const blob = await getViewImage(view.id);
    expect(blob).toBeInstanceOf(Blob);
    expect(state.downloads).toEqual([`${FAKE_UID}/views/${view.id}.jpg`]);
  });
});

describe('importRecords (merge by id)', () => {
  it('keeps existing trees, inserts only new ones, and counts correctly', async () => {
    const existing = await createTree(treeInput({ commonName: 'Bigleaf maple' }));
    const incoming: Tree[] = [
      { ...existing, commonName: 'WRONG NAME FROM BACKUP' },
      {
        ...treeInput({ commonName: 'Western redcedar', species: 'Thuja plicata' }),
        id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        createdAt: '2026-06-01T12:00:00.000Z',
        updatedAt: '2026-06-02T12:00:00.000Z',
      },
    ];
    const counts = await importRecords(incoming, []);
    expect(counts).toEqual({ trees: 1, photos: 0 });

    const kept = await getTree(existing.id);
    expect(kept?.commonName).toBe('Bigleaf maple'); // existing wins

    const imported = await getTree('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(imported?.commonName).toBe('Western redcedar');
    expect(imported?.createdAt).toBe('2026-06-01T12:00:00.000Z'); // timestamps preserved
    expect(imported?.updatedAt).toBe('2026-06-02T12:00:00.000Z');
  });

  it('defaults fields missing from old backups', async () => {
    // Pre-status/nickname era backup record: those keys simply don't exist.
    const legacy = {
      id: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff',
      lat: 45.51,
      lng: -122.67,
      commonName: 'Oregon white oak',
      species: 'Quercus garryana',
      dateEncountered: '2025-05-05',
      notes: '',
      confidence: 'low',
      createdAt: '2025-05-05T12:00:00.000Z',
      updatedAt: '2025-05-05T12:00:00.000Z',
    } as unknown as Tree;
    await importRecords([legacy], []);
    const row = rows('trees')[0];
    expect(row.status).toBe('guessed');
    expect(row.is_public).toBe(false);
    expect(row.nickname).toBe('');
    expect(row.location_label).toBe('');
  });

  it('imports photos only for known trees and skips existing photo ids', async () => {
    const tree = await createTree(treeInput());
    const existingPhoto = await addPhoto(tree.id, new Blob(['old']));
    state.uploads = []; // only track import uploads below

    const counts = await importRecords(
      [],
      [
        { id: existingPhoto.id, treeId: tree.id, blob: new Blob(['dupe']) },
        { id: 'cccccccc-dddd-eeee-ffff-000000000000', treeId: tree.id, blob: new Blob(['new']) },
        { id: 'dddddddd-eeee-ffff-0000-111111111111', treeId: 'not-a-known-tree', blob: new Blob(['orphan']) },
      ],
    );
    expect(counts).toEqual({ trees: 0, photos: 1 });
    expect(state.uploads).toEqual([`${FAKE_UID}/${tree.id}/cccccccc-dddd-eeee-ffff-000000000000.jpg`]);
    expect(rows('photos')).toHaveLength(2);
  });
});
