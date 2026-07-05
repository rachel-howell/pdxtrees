import { supabase } from './supabase';
import { currentUserId } from './auth';

export type Confidence = 'high' | 'medium' | 'low';

export interface Tree {
  id: string;
  lat: number;
  lng: number;
  commonName: string;
  /** Personal name for the tree, distinct from species/common name. */
  nickname?: string;
  species: string;
  dateEncountered: string; // ISO date (yyyy-mm-dd)
  notes: string;
  confidence: Confidence;
  /** Human-readable spot, e.g. "SW Park Ave & SW Salmon St". Auto-filled, user-editable. */
  locationLabel: string;
  /** Per-tree opt-in; only effective when the account privacy switch is off. */
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Photo {
  id: string;
  treeId: string;
  blob: Blob;
}

const BUCKET = 'tree-photos';

interface TreeRow {
  id: string;
  user_id: string;
  common_name: string;
  nickname: string;
  species: string;
  date_encountered: string;
  notes: string;
  confidence: Confidence;
  location_label: string;
  lat: number;
  lng: number;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

interface PhotoRow {
  id: string;
  tree_id: string;
  user_id: string;
}

function fromRow(r: TreeRow): Tree {
  return {
    id: r.id,
    lat: r.lat,
    lng: r.lng,
    commonName: r.common_name,
    nickname: r.nickname,
    species: r.species,
    dateEncountered: r.date_encountered,
    notes: r.notes,
    confidence: r.confidence,
    locationLabel: r.location_label,
    isPublic: r.is_public,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toRow(data: Partial<Omit<Tree, 'id' | 'createdAt' | 'updatedAt'>>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (data.lat !== undefined) row.lat = data.lat;
  if (data.lng !== undefined) row.lng = data.lng;
  if (data.commonName !== undefined) row.common_name = data.commonName;
  if (data.nickname !== undefined) row.nickname = data.nickname;
  if (data.species !== undefined) row.species = data.species;
  if (data.dateEncountered !== undefined) row.date_encountered = data.dateEncountered;
  if (data.notes !== undefined) row.notes = data.notes;
  if (data.confidence !== undefined) row.confidence = data.confidence;
  if (data.locationLabel !== undefined) row.location_label = data.locationLabel;
  if (data.isPublic !== undefined) row.is_public = data.isPublic;
  return row;
}

async function requireUid(): Promise<string> {
  const uid = await currentUserId();
  if (!uid) throw new Error('You must be logged in to do that.');
  return uid;
}

function photoPath(userId: string, treeId: string, photoId: string): string {
  return `${userId}/${treeId}/${photoId}.jpg`;
}

// --- Repository: all persistence goes through here.

export async function listTrees(): Promise<Tree[]> {
  const uid = await currentUserId();
  let query = supabase.from('trees').select('*');
  if (uid) query = query.eq('user_id', uid); // logged in: own trees; anon: RLS exposes public ones
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data as TreeRow[]).map(fromRow);
}

/** Single tree by id; null when it doesn't exist or RLS hides it (private + not owner). */
export async function getTree(id: string): Promise<Tree | null> {
  const { data, error } = await supabase.from('trees').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? fromRow(data as TreeRow) : null;
}

export async function createTree(
  data: Omit<Tree, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<Tree> {
  await requireUid();
  const { data: row, error } = await supabase
    .from('trees')
    .insert({ id: crypto.randomUUID(), ...toRow(data) })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return fromRow(row as TreeRow);
}

export async function updateTree(
  id: string,
  data: Partial<Omit<Tree, 'id' | 'createdAt' | 'updatedAt'>>,
): Promise<void> {
  const { error } = await supabase
    .from('trees')
    .update({ ...toRow(data), updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteTree(id: string): Promise<void> {
  const uid = await requireUid();
  const { data: photoRows, error: photoErr } = await supabase
    .from('photos')
    .select('id')
    .eq('tree_id', id);
  if (photoErr) throw new Error(photoErr.message);
  if (photoRows.length > 0) {
    await supabase.storage
      .from(BUCKET)
      .remove(photoRows.map((p) => photoPath(uid, id, p.id)));
  }
  const { error } = await supabase.from('trees').delete().eq('id', id); // photo rows cascade
  if (error) throw new Error(error.message);
}

export async function getPhotos(treeId: string): Promise<Photo[]> {
  const { data: rows, error } = await supabase
    .from('photos')
    .select('id, tree_id, user_id')
    .eq('tree_id', treeId);
  if (error) throw new Error(error.message);
  return Promise.all(
    (rows as PhotoRow[]).map(async (r) => {
      const { data: blob, error: dlErr } = await supabase.storage
        .from(BUCKET)
        .download(photoPath(r.user_id, r.tree_id, r.id));
      if (dlErr) throw new Error(dlErr.message);
      return { id: r.id, treeId: r.tree_id, blob: blob as Blob };
    }),
  );
}

export async function addPhoto(treeId: string, blob: Blob): Promise<Photo> {
  const uid = await requireUid();
  const id = crypto.randomUUID();
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(photoPath(uid, treeId, id), blob, { contentType: 'image/jpeg' });
  if (upErr) throw new Error(upErr.message);
  const { error } = await supabase.from('photos').insert({ id, tree_id: treeId });
  if (error) {
    await supabase.storage.from(BUCKET).remove([photoPath(uid, treeId, id)]);
    throw new Error(error.message);
  }
  return { id, treeId, blob };
}

export async function deletePhoto(id: string): Promise<void> {
  const { data: row, error: selErr } = await supabase
    .from('photos')
    .select('id, tree_id, user_id')
    .eq('id', id)
    .single();
  if (selErr) throw new Error(selErr.message);
  const r = row as PhotoRow;
  await supabase.storage.from(BUCKET).remove([photoPath(r.user_id, r.tree_id, r.id)]);
  const { error } = await supabase.from('photos').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// --- Account privacy (profiles.account_private master switch)

export async function getAccountPrivate(): Promise<boolean> {
  const uid = await requireUid();
  const { data, error } = await supabase
    .from('profiles')
    .select('account_private')
    .eq('id', uid)
    .single();
  if (error) throw new Error(error.message);
  return data.account_private;
}

export async function setAccountPrivate(value: boolean): Promise<void> {
  const uid = await requireUid();
  const { error } = await supabase
    .from('profiles')
    .update({ account_private: value, updated_at: new Date().toISOString() })
    .eq('id', uid);
  if (error) throw new Error(error.message);
}

// --- Export/import support

export async function getAllPhotos(): Promise<Photo[]> {
  const uid = await requireUid();
  const { data: rows, error } = await supabase
    .from('photos')
    .select('id, tree_id, user_id')
    .eq('user_id', uid);
  if (error) throw new Error(error.message);
  return Promise.all(
    (rows as PhotoRow[]).map(async (r) => {
      const { data: blob, error: dlErr } = await supabase.storage
        .from(BUCKET)
        .download(photoPath(r.user_id, r.tree_id, r.id));
      if (dlErr) throw new Error(dlErr.message);
      return { id: r.id, treeId: r.tree_id, blob: blob as Blob };
    }),
  );
}

/** Merge by id: existing records win, imported ones only fill gaps. */
export async function importRecords(
  trees: Tree[],
  photos: Photo[],
): Promise<{ trees: number; photos: number }> {
  const uid = await requireUid();
  const { data: existingTreeRows, error: tErr } = await supabase.from('trees').select('id').eq('user_id', uid);
  if (tErr) throw new Error(tErr.message);
  const { data: existingPhotoRows, error: pErr } = await supabase.from('photos').select('id').eq('user_id', uid);
  if (pErr) throw new Error(pErr.message);
  const existingTreeIds = new Set(existingTreeRows.map((r) => r.id));
  const existingPhotoIds = new Set(existingPhotoRows.map((r) => r.id));

  const newTrees = trees.filter((t) => !existingTreeIds.has(t.id));
  if (newTrees.length > 0) {
    const { error } = await supabase.from('trees').insert(
      newTrees.map((t) => ({
        id: t.id,
        ...toRow({
          ...t,
          isPublic: t.isPublic ?? false,
          nickname: t.nickname ?? '',
          locationLabel: t.locationLabel ?? '',
        }),
        created_at: t.createdAt,
        updated_at: t.updatedAt,
      })),
    );
    if (error) throw new Error(error.message);
  }

  const importedTreeIds = new Set([...existingTreeIds, ...newTrees.map((t) => t.id)]);
  const newPhotos = photos.filter((p) => !existingPhotoIds.has(p.id) && importedTreeIds.has(p.treeId));
  for (const p of newPhotos) {
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(photoPath(uid, p.treeId, p.id), p.blob, { contentType: 'image/jpeg', upsert: true });
    if (upErr) throw new Error(upErr.message);
    const { error } = await supabase.from('photos').insert({ id: p.id, tree_id: p.treeId });
    if (error) throw new Error(error.message);
  }
  return { trees: newTrees.length, photos: newPhotos.length };
}
