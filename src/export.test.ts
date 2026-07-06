import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./db', () => ({
  listTrees: vi.fn(),
  getAllPhotos: vi.fn(),
  importRecords: vi.fn(),
}));

import { exportData, importData } from './export';
import { getAllPhotos, importRecords, listTrees, type Photo, type Tree } from './db';

// Invented sample data — never real trees.
const sampleTree: Tree = {
  id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  lat: 45.52,
  lng: -122.68,
  commonName: 'Douglas fir',
  nickname: 'The Tall One',
  species: 'Pseudotsuga menziesii',
  dateEncountered: '2026-07-01',
  notes: 'test notes',
  confidence: 'high',
  status: 'confirmed',
  locationLabel: 'SW Park Ave & SW Salmon St',
  isPublic: false,
  createdAt: '2026-07-01T12:00:00.000Z',
  updatedAt: '2026-07-01T12:00:00.000Z',
};

let capturedBlobs: Blob[];
let capturedDownloads: string[];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listTrees).mockResolvedValue([]);
  vi.mocked(getAllPhotos).mockResolvedValue([]);
  vi.mocked(importRecords).mockResolvedValue({ trees: 0, photos: 0 });
  capturedBlobs = [];
  capturedDownloads = [];
  // jsdom has no createObjectURL; capture the blob instead of minting a URL
  URL.createObjectURL = vi.fn((blob: Blob) => {
    capturedBlobs.push(blob);
    return 'blob:mock';
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    capturedDownloads.push(this.download);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('backup round-trip', () => {
  it('export → import reproduces trees and byte-identical photos', async () => {
    const bytes = new Uint8Array(256).map((_, i) => i);
    const photo: Photo = {
      id: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff',
      treeId: sampleTree.id,
      blob: new Blob([bytes], { type: 'image/jpeg' }),
    };
    vi.mocked(listTrees).mockResolvedValue([sampleTree]);
    vi.mocked(getAllPhotos).mockResolvedValue([photo]);

    await exportData();
    expect(capturedBlobs).toHaveLength(1);
    const json = await capturedBlobs[0].text();

    await importData(new File([json], 'backup.json', { type: 'application/json' }));
    expect(importRecords).toHaveBeenCalledTimes(1);
    const [trees, photos] = vi.mocked(importRecords).mock.calls[0];
    expect(trees).toEqual([sampleTree]);
    expect(photos).toHaveLength(1);
    expect(photos[0].id).toBe(photo.id);
    expect(photos[0].treeId).toBe(photo.treeId);
    expect(photos[0].blob.type).toBe('image/jpeg');
    expect(new Uint8Array(await photos[0].blob.arrayBuffer())).toEqual(bytes);
  });

  it('rejects files that are not PDX Trees backups', async () => {
    const wrongApp = JSON.stringify({ app: 'other', version: 1, trees: [], photos: [] });
    await expect(importData(new File([wrongApp], 'x.json'))).rejects.toThrow(/not a pdx trees backup/i);
    await expect(importData(new File(['{oops'], 'x.json'))).rejects.toThrow();
    expect(importRecords).not.toHaveBeenCalled();
  });
});

describe('export filename', () => {
  it('uses the local date, not UTC (Portland evenings are already tomorrow in UTC)', async () => {
    // 21:30 PDT on July 4 = 04:30 UTC on July 5 — the bug that shipped twice
    vi.useFakeTimers({ now: new Date('2026-07-04T21:30:00-07:00') });
    await exportData();
    expect(capturedDownloads).toEqual(['pdxtrees-2026-07-04.json']);
  });
});
