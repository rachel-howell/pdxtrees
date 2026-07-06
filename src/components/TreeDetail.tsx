import { useEffect, useState } from 'react';
import {
  displayName,
  getPhotos,
  updateTree,
  type Confidence,
  type Photo,
  type Tree,
  type TreeStatus,
} from '../db';

const CONFIDENCE_LABEL = { high: 'High', medium: 'Medium', low: 'Low' } as const;
const STATUS_LABEL = { spotted: 'Spotted', guessed: 'Guessed', confirmed: 'Confirmed' } as const;

const STATUSES: TreeStatus[] = ['spotted', 'guessed', 'confirmed'];
const CONFIDENCES: Confidence[] = ['high', 'medium', 'low'];

type PillMenu = 'status' | 'confidence' | 'visibility';

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
  /** Open the edit form with a status preselected (nameless tree can't be quick-changed). */
  onEditWithStatus: (status: TreeStatus) => void;
  onUpdated: () => void;
  onNotify: (message: string) => void;
  onDelete: () => void;
  onClose: () => void;
}

export default function TreeDetail({
  tree,
  accountPrivate,
  readOnly,
  onShowQr,
  onEdit,
  onEditWithStatus,
  onUpdated,
  onNotify,
  onDelete,
  onClose,
}: Props) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [openMenu, setOpenMenu] = useState<PillMenu | null>(null);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    setConfirmingDelete(false);
    setOpenMenu(null);
    setPhotos([]);
    getPhotos(tree.id).then(setPhotos).catch(() => {});
  }, [tree]);

  async function quickUpdate(patch: Partial<Pick<Tree, 'status' | 'confidence' | 'isPublic'>>) {
    setUpdating(true);
    try {
      await updateTree(tree.id, patch);
      onUpdated();
      setOpenMenu(null);
      if (patch.isPublic && accountPrivate) {
        onNotify('Marked public — hidden until you turn off account privacy in the menu.');
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not update.');
    } finally {
      setUpdating(false);
    }
  }

  function pickStatus(status: TreeStatus) {
    if (status === tree.status) {
      setOpenMenu(null);
    } else if (status !== 'spotted' && !tree.commonName) {
      // Name is required once identified — finish the change in the form.
      setOpenMenu(null);
      onEditWithStatus(status);
    } else {
      quickUpdate({ status });
    }
  }

  const togglePill = (menu: PillMenu) => setOpenMenu(openMenu === menu ? null : menu);

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
        {readOnly ? (
          <span className={`badge badge-${tree.status}`}>{STATUS_LABEL[tree.status]}</span>
        ) : (
          <button
            className={`badge badge-btn badge-${tree.status}`}
            aria-expanded={openMenu === 'status'}
            onClick={() => togglePill('status')}
          >
            {STATUS_LABEL[tree.status]} ▾
          </button>
        )}
        {tree.status !== 'spotted' &&
          (readOnly ? (
            <span className={`badge badge-${tree.confidence}`}>
              {CONFIDENCE_LABEL[tree.confidence]} confidence
            </span>
          ) : (
            <button
              className={`badge badge-btn badge-${tree.confidence}`}
              aria-expanded={openMenu === 'confidence'}
              onClick={() => togglePill('confidence')}
            >
              {CONFIDENCE_LABEL[tree.confidence]} confidence ▾
            </button>
          ))}
        {!readOnly && (
          <button
            className={`badge badge-btn ${visibility.cls}`}
            aria-expanded={openMenu === 'visibility'}
            onClick={() => togglePill('visibility')}
          >
            {visibility.label} ▾
          </button>
        )}
        <span className="detail-date">Encountered {tree.dateEncountered}</span>
      </div>

      {openMenu && (
        <div className="pill-menu">
          {openMenu === 'status' &&
            STATUSES.map((s) => (
              <button
                key={s}
                className="pill-option"
                disabled={updating}
                onClick={() => pickStatus(s)}
              >
                <span className={`radio${tree.status === s ? ' radio-on' : ''}`} />
                <span className={`dot dot-${s}`} />
                {STATUS_LABEL[s]}
              </button>
            ))}
          {openMenu === 'confidence' &&
            CONFIDENCES.map((c) => (
              <button
                key={c}
                className="pill-option"
                disabled={updating}
                onClick={() =>
                  c === tree.confidence ? setOpenMenu(null) : quickUpdate({ confidence: c })
                }
              >
                <span className={`radio${tree.confidence === c ? ' radio-on' : ''}`} />
                {CONFIDENCE_LABEL[c]} confidence
              </button>
            ))}
          {openMenu === 'visibility' &&
            ([false, true] as const).map((pub) => (
              <button
                key={String(pub)}
                className="pill-option"
                disabled={updating}
                onClick={() =>
                  pub === tree.isPublic ? setOpenMenu(null) : quickUpdate({ isPublic: pub })
                }
              >
                <span className={`radio${tree.isPublic === pub ? ' radio-on' : ''}`} />
                {pub ? 'Public' : 'Private'}
              </button>
            ))}
          <button className="pill-option pill-option-edit" onClick={onEdit}>
            Edit tree…
          </button>
        </div>
      )}

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
