import { getAllPhotos, importRecords, listTrees, type Photo, type Tree } from './db';

interface ExportedPhoto {
  id: string;
  treeId: string;
  type: string;
  data: string; // base64 (no data: prefix)
}

interface ExportFile {
  app: 'pdxtrees';
  version: 1;
  exportedAt: string;
  trees: Tree[];
  photos: ExportedPhoto[];
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',', 2)[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function base64ToBlob(data: string, type: string): Promise<Blob> {
  const res = await fetch(`data:${type};base64,${data}`);
  return res.blob();
}

/** Build the backup file and trigger a download. */
export async function exportData(): Promise<void> {
  const [trees, photos] = await Promise.all([listTrees(), getAllPhotos()]);
  const exported: ExportFile = {
    app: 'pdxtrees',
    version: 1,
    exportedAt: new Date().toISOString(),
    trees,
    photos: await Promise.all(
      photos.map(async (p) => ({
        id: p.id,
        treeId: p.treeId,
        type: p.blob.type || 'image/jpeg',
        data: await blobToBase64(p.blob),
      })),
    ),
  };
  const blob = new Blob([JSON.stringify(exported)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pdxtrees-${new Date().toLocaleDateString('en-CA')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Import a backup file, merging by id (existing records are kept). */
export async function importData(file: File): Promise<{ trees: number; photos: number }> {
  const parsed = JSON.parse(await file.text()) as ExportFile;
  if (parsed.app !== 'pdxtrees' || !Array.isArray(parsed.trees) || !Array.isArray(parsed.photos)) {
    throw new Error('Not a PDX Trees backup file');
  }
  const photos: Photo[] = await Promise.all(
    parsed.photos.map(async (p) => ({
      id: p.id,
      treeId: p.treeId,
      blob: await base64ToBlob(p.data, p.type),
    })),
  );
  return importRecords(parsed.trees, photos);
}
