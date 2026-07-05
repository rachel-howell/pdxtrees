import { useEffect, useState } from 'react';
import {
  addPhoto,
  createTree,
  deletePhoto,
  getPhotos,
  updateTree,
  type Confidence,
  type Photo,
  type Tree,
} from '../db';
import { compressImage } from '../image';

const CONFIDENCES: { value: Confidence; label: string }[] = [
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

/** Thumbnail that owns (and revokes) its object URL. */
function PhotoThumb({ blob, onRemove }: { blob: Blob; onRemove: () => void }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return (
    <div className="photo-thumb">
      {url && <img src={url} alt="Tree photo" />}
      <button type="button" className="photo-remove" aria-label="Remove photo" onClick={onRemove}>
        ✕
      </button>
    </div>
  );
}

interface Props {
  tree?: Tree; // edit mode when set
  coords: { lat: number; lng: number };
  accountPrivate: boolean;
  onSaved: (treeId: string) => void;
  onCancel: () => void;
}

export default function TreeForm({ tree, coords, accountPrivate, onSaved, onCancel }: Props) {
  const [commonName, setCommonName] = useState(tree?.commonName ?? '');
  const [nickname, setNickname] = useState(tree?.nickname ?? '');
  const [species, setSpecies] = useState(tree?.species ?? '');
  const [dateEncountered, setDateEncountered] = useState(
    // en-CA formats as yyyy-mm-dd; unlike toISOString this stays in local time
    tree?.dateEncountered ?? new Date().toLocaleDateString('en-CA'),
  );
  const [confidence, setConfidence] = useState<Confidence>(tree?.confidence ?? 'medium');
  const [isPublic, setIsPublic] = useState(tree?.isPublic ?? false);
  const [notes, setNotes] = useState(tree?.notes ?? '');
  const [lat, setLat] = useState(String(tree?.lat ?? coords.lat));
  const [lng, setLng] = useState(String(tree?.lng ?? coords.lng));
  const [existingPhotos, setExistingPhotos] = useState<Photo[]>([]);
  const [removedPhotoIds, setRemovedPhotoIds] = useState<Set<string>>(new Set());
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (tree) getPhotos(tree.id).then(setExistingPhotos);
  }, [tree]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (!commonName.trim()) {
      setError('Name is required.');
      return;
    }
    if (!Number.isFinite(latNum) || latNum < -90 || latNum > 90) {
      setError('Latitude must be a number between -90 and 90.');
      return;
    }
    if (!Number.isFinite(lngNum) || lngNum < -180 || lngNum > 180) {
      setError('Longitude must be a number between -180 and 180.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      const data = {
        commonName: commonName.trim(),
        nickname: nickname.trim(),
        species: species.trim(),
        dateEncountered,
        notes: notes.trim(),
        confidence,
        isPublic,
        lat: latNum,
        lng: lngNum,
      };
      let treeId: string;
      if (tree) {
        await updateTree(tree.id, data);
        treeId = tree.id;
        for (const id of removedPhotoIds) await deletePhoto(id);
      } else {
        treeId = (await createTree(data)).id;
      }
      for (const file of newFiles) {
        await addPhoto(treeId, await compressImage(file));
      }
      onSaved(treeId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save.');
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <form className="modal tree-form" onSubmit={handleSubmit}>
        <h2>{tree ? 'Edit tree' : 'New tree'}</h2>

        <label>
          Name<span className="req">*</span>
          <input
            value={commonName}
            onChange={(e) => setCommonName(e.target.value)}
            placeholder="e.g. Douglas fir"
            autoFocus
          />
        </label>

        <label>
          Nickname (optional)
          <input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="e.g. The Lopsided One"
          />
        </label>

        <label>
          Species (scientific name)
          <input
            value={species}
            onChange={(e) => setSpecies(e.target.value)}
            placeholder="e.g. Pseudotsuga menziesii"
          />
        </label>

        <div className="form-row">
          <label>
            Date encountered
            <input
              type="date"
              value={dateEncountered}
              onChange={(e) => setDateEncountered(e.target.value)}
            />
          </label>
          <fieldset className="confidence-picker">
            <legend>Confidence</legend>
            <div className="segmented">
              {CONFIDENCES.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  className={`seg seg-${c.value} ${confidence === c.value ? 'active' : ''}`}
                  onClick={() => setConfidence(c.value)}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </fieldset>
        </div>

        <div className="form-row">
          <label>
            Latitude
            <input inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} />
          </label>
          <label>
            Longitude
            <input inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} />
          </label>
        </div>

        <fieldset className="confidence-picker">
          <legend>Visibility</legend>
          <div className="segmented">
            <button
              type="button"
              className={`seg seg-private ${!isPublic ? 'active' : ''}`}
              onClick={() => setIsPublic(false)}
            >
              Private
            </button>
            <button
              type="button"
              className={`seg seg-public ${isPublic ? 'active' : ''}`}
              onClick={() => setIsPublic(true)}
            >
              Public
            </button>
          </div>
          {isPublic && accountPrivate && (
            <p className="field-hint">
              Your account-level privacy setting is on, so this tree stays hidden until you turn
              that off in the menu.
            </p>
          )}
        </fieldset>

        <label>
          Notes
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="How you identified it, what it looks like from your window…"
          />
        </label>

        <div className="photo-section">
          <span className="photo-label">Photos</span>
          <div className="photo-grid">
            {existingPhotos
              .filter((p) => !removedPhotoIds.has(p.id))
              .map((p) => (
                <PhotoThumb
                  key={p.id}
                  blob={p.blob}
                  onRemove={() =>
                    setRemovedPhotoIds((prev) => new Set(prev).add(p.id))
                  }
                />
              ))}
            {newFiles.map((f, i) => (
              <PhotoThumb
                key={`${f.name}-${i}`}
                blob={f}
                onRemove={() => setNewFiles((prev) => prev.filter((_, j) => j !== i))}
              />
            ))}
            <label className="photo-add">
              +
              {/* no `capture` attr: iOS then offers Photo Library / Take Photo */}
              <input
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length) setNewFiles((prev) => [...prev, ...files]);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
        </div>

        {error && <p className="form-error">{error}</p>}

        <div className="form-actions">
          <button type="button" className="btn" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save tree'}
          </button>
        </div>
      </form>
    </div>
  );
}
