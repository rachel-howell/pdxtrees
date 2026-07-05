import Dexie, { type Table } from 'dexie';

export type Confidence = 'high' | 'medium' | 'low';

export interface Tree {
  id: string;
  lat: number;
  lng: number;
  commonName: string;
  /** Personal name for the tree, distinct from species/common name. Absent on pre-v2 records. */
  nickname?: string;
  species: string;
  dateEncountered: string; // ISO date (yyyy-mm-dd)
  notes: string;
  confidence: Confidence;
  createdAt: string;
  updatedAt: string;
}

export interface Photo {
  id: string;
  treeId: string;
  blob: Blob;
}

class TreeDB extends Dexie {
  trees!: Table<Tree, string>;
  photos!: Table<Photo, string>;

  constructor() {
    super('pdxtrees');
    this.version(1).stores({
      trees: 'id',
      photos: 'id, treeId',
    });
  }
}

const db = new TreeDB();

// --- Repository: all persistence goes through here so a cloud backend can
// --- replace the internals later without touching components.

export function listTrees(): Promise<Tree[]> {
  return db.trees.toArray();
}

export async function createTree(
  data: Omit<Tree, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<Tree> {
  const now = new Date().toISOString();
  const tree: Tree = { ...data, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
  await db.trees.add(tree);
  return tree;
}

export async function updateTree(
  id: string,
  data: Partial<Omit<Tree, 'id' | 'createdAt' | 'updatedAt'>>,
): Promise<void> {
  await db.trees.update(id, { ...data, updatedAt: new Date().toISOString() });
}

export async function deleteTree(id: string): Promise<void> {
  await db.transaction('rw', db.trees, db.photos, async () => {
    await db.photos.where('treeId').equals(id).delete();
    await db.trees.delete(id);
  });
}

export function getPhotos(treeId: string): Promise<Photo[]> {
  return db.photos.where('treeId').equals(treeId).toArray();
}

export async function addPhoto(treeId: string, blob: Blob): Promise<Photo> {
  const photo: Photo = { id: crypto.randomUUID(), treeId, blob };
  await db.photos.add(photo);
  return photo;
}

export function deletePhoto(id: string): Promise<void> {
  return db.photos.delete(id);
}

// --- Export/import support

export function getAllPhotos(): Promise<Photo[]> {
  return db.photos.toArray();
}

/** Merge by id: existing records win, imported ones only fill gaps. */
export async function importRecords(
  trees: Tree[],
  photos: Photo[],
): Promise<{ trees: number; photos: number }> {
  return db.transaction('rw', db.trees, db.photos, async () => {
    const existingTreeIds = new Set(await db.trees.toCollection().primaryKeys());
    const existingPhotoIds = new Set(await db.photos.toCollection().primaryKeys());
    const newTrees = trees.filter((t) => !existingTreeIds.has(t.id));
    const newPhotos = photos.filter((p) => !existingPhotoIds.has(p.id));
    await db.trees.bulkAdd(newTrees);
    await db.photos.bulkAdd(newPhotos);
    return { trees: newTrees.length, photos: newPhotos.length };
  });
}
