import Dexie from 'dexie';
import type { Photo, Tree } from './db';

/**
 * Reads what remains of the pre-cloud IndexedDB database so it can be
 * migrated to Supabase, then deleted.
 */

interface LegacyTree extends Omit<Tree, 'isPublic'> {
  isPublic?: boolean;
}

function openLegacy(): Dexie {
  const db = new Dexie('pdxtrees');
  db.version(1).stores({ trees: 'id', photos: 'id, treeId' });
  return db;
}

export async function readLegacyData(): Promise<{ trees: Tree[]; photos: Photo[] } | null> {
  if (!(await Dexie.exists('pdxtrees'))) return null;
  const db = openLegacy();
  try {
    const trees = (await db.table('trees').toArray()) as LegacyTree[];
    if (trees.length === 0) return null;
    const photos = (await db.table('photos').toArray()) as Photo[];
    return {
      trees: trees.map((t) => ({ ...t, isPublic: false, nickname: t.nickname ?? '' })),
      photos,
    };
  } finally {
    db.close();
  }
}

export async function clearLegacyData(): Promise<void> {
  await Dexie.delete('pdxtrees');
}
