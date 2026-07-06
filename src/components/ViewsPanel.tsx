import { useEffect, useRef, useState } from 'react';
import { createView, deleteView, listViews, type WindowView } from '../db';
import { compressImage } from '../image';

interface Props {
  onOpen: (view: WindowView) => void;
  onClose: () => void;
  onNotify: (message: string) => void;
}

export default function ViewsPanel({ onOpen, onClose, onNotify }: Props) {
  const [views, setViews] = useState<WindowView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listViews()
      .then(setViews)
      .catch(() => onNotify('Could not load views.'))
      .finally(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(file: File) {
    setCreating(true);
    try {
      // higher resolution than tree photos: panoramas need the detail
      const blob = await compressImage(file, 2400, 0.85);
      const view = await createView(name.trim() || 'My view', blob);
      setViews((prev) => [...prev, view]);
      setName('');
      onOpen(view);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not add the view.');
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteView(id);
      setViews((prev) => prev.filter((v) => v.id !== id));
      setConfirmingDelete(null);
      onNotify('View deleted.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Delete failed.');
    }
  }

  return (
    <div className="list-view">
      <div className="list-controls">
        <div className="search-row">
          <h2 className="views-title">Window views</h2>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="search-row">
          <input
            placeholder="Name for a new view, e.g. Living room east"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            className="btn btn-primary"
            disabled={creating}
            onClick={() => fileRef.current?.click()}
          >
            {creating ? 'Adding…' : 'Add photo'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleCreate(file);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      {loaded && views.length === 0 ? (
        <p className="list-empty">
          No views yet. Name one and add a photo of the view from your window — then long-press
          the photo to mark which tree is which.
        </p>
      ) : (
        <ul className="tree-list">
          {views.map((v) => (
            <li key={v.id}>
              <div className="view-row">
                <button className="tree-row" onClick={() => onOpen(v)}>
                  <span className="tree-row-main">
                    <span className="tree-row-name">{v.name}</span>
                    <span className="tree-row-species">
                      added {v.createdAt.slice(0, 10)}
                    </span>
                  </span>
                </button>
                {confirmingDelete === v.id ? (
                  <>
                    <button className="btn btn-danger" onClick={() => handleDelete(v.id)}>
                      Really?
                    </button>
                    <button className="btn" onClick={() => setConfirmingDelete(null)}>
                      Keep
                    </button>
                  </>
                ) : (
                  <button
                    className="btn btn-danger-outline"
                    onClick={() => setConfirmingDelete(v.id)}
                  >
                    Delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
