import { useEffect, useState } from 'react';
import { displayName, getPhotos, type Photo, type Tree } from '../db';

const CONFIDENCE_LABEL = { high: 'High', medium: 'Medium', low: 'Low' } as const;
const STATUS_LABEL = { spotted: 'Spotted', guessed: 'Guessed', confirmed: 'Confirmed' } as const;

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
  accountPrivate: boolean;
  readOnly: boolean;
  onShowQr: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export default function TreeDetail({
  tree,
  accountPrivate,
  readOnly,
  onShowQr,
  onEdit,
  onDelete,
  onClose,
}: Props) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    setConfirmingDelete(false);
    setPhotos([]);
    getPhotos(tree.id).then(setPhotos).catch(() => {});
  }, [tree]);

  const visibility = !tree.isPublic
    ? { label: 'Private', cls: 'badge-private' }
    : accountPrivate && !readOnly
      ? { label: 'Public · hidden by account privacy', cls: 'badge-muted-public' }
      : { label: 'Public', cls: 'badge-public' };

  return (
    <aside className="detail-panel">
      <div className="detail-header">
        <div>
          <h2>{displayName(tree)}</h2>
          {tree.nickname && tree.commonName && <p className="detail-common">{tree.commonName}</p>}
          {tree.species && <p className="detail-species">{tree.species}</p>}
        </div>
        <button className="icon-btn" aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="detail-meta">
        <span className={`badge badge-${tree.status}`}>{STATUS_LABEL[tree.status]}</span>
        {tree.status !== 'spotted' && (
          <span className={`badge badge-${tree.confidence}`}>
            {CONFIDENCE_LABEL[tree.confidence]} confidence
          </span>
        )}
        {!readOnly && <span className={`badge ${visibility.cls}`}>{visibility.label}</span>}
        <span className="detail-date">Encountered {tree.dateEncountered}</span>
      </div>

      {tree.locationLabel && <p className="detail-location">📍 {tree.locationLabel}</p>}

      <p className="detail-coords">
        {tree.lat.toFixed(5)}, {tree.lng.toFixed(5)}
      </p>

      {tree.notes && <p className="detail-notes">{tree.notes}</p>}

      {photos.map((p) => (
        <PhotoView key={p.id} photo={p} />
      ))}

      {!readOnly && (
        <div className="detail-actions">
          <button className="btn" onClick={onEdit}>
            Edit
          </button>
          <button className="btn" onClick={onShowQr}>
            QR
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
      )}
    </aside>
  );
}
