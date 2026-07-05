import { useEffect, useState } from 'react';
import { getPhotos, type Photo, type Tree } from '../db';

const CONFIDENCE_LABEL = { high: 'High', medium: 'Medium', low: 'Low' } as const;

function PhotoView({ photo }: { photo: Photo }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const u = URL.createObjectURL(photo.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [photo]);
  return url ? <img className="detail-photo" src={url} alt="Tree photo" /> : null;
}

interface Props {
  tree: Tree;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export default function TreeDetail({ tree, onEdit, onDelete, onClose }: Props) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    setConfirmingDelete(false);
    getPhotos(tree.id).then(setPhotos);
  }, [tree]);

  return (
    <aside className="detail-panel">
      <div className="detail-header">
        <div>
          <h2>{tree.commonName}</h2>
          {tree.species && <p className="detail-species">{tree.species}</p>}
        </div>
        <button className="icon-btn" aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="detail-meta">
        <span className={`badge badge-${tree.confidence}`}>
          {CONFIDENCE_LABEL[tree.confidence]} confidence
        </span>
        <span className="detail-date">Encountered {tree.dateEncountered}</span>
      </div>

      <p className="detail-coords">
        {tree.lat.toFixed(5)}, {tree.lng.toFixed(5)}
      </p>

      {tree.notes && <p className="detail-notes">{tree.notes}</p>}

      {photos.map((p) => (
        <PhotoView key={p.id} photo={p} />
      ))}

      <div className="detail-actions">
        <button className="btn" onClick={onEdit}>
          Edit
        </button>
        {confirmingDelete ? (
          <>
            <button className="btn btn-danger" onClick={onDelete}>
              Really delete?
            </button>
            <button className="btn" onClick={() => setConfirmingDelete(false)}>
              Keep
            </button>
          </>
        ) : (
          <button className="btn btn-danger-outline" onClick={() => setConfirmingDelete(true)}>
            Delete
          </button>
        )}
      </div>
    </aside>
  );
}
