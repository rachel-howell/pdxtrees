import { useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { displayName, type Tree } from '../db';
import { treeUrl } from '../config';

interface Props {
  trees: Tree[];
  onClose: () => void;
}

/** Printable sheet of QR labels (~2.5×3in cards, 6 per page) for the physical archive. */
export default function LabelSheet({ trees, onClose }: Props) {
  useEffect(() => {
    document.body.classList.add('printing-labels');
    return () => document.body.classList.remove('printing-labels');
  }, []);

  return (
    <div className="label-sheet">
      <div className="label-toolbar">
        <h2>
          QR label{trees.length === 1 ? '' : 's'} · {trees.length} tree
          {trees.length === 1 ? '' : 's'}
        </h2>
        <div className="label-toolbar-actions">
          <button className="btn btn-primary" onClick={() => window.print()}>
            Print
          </button>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      <div className="label-grid">
        {trees.map((t) => (
          <div className="label-card" key={t.id}>
            <QRCodeSVG value={treeUrl(t.id)} level="M" marginSize={2} className="label-qr" />
            <span className="label-name">{displayName(t)}</span>
            {t.nickname && t.commonName && <span className="label-sub">{t.commonName}</span>}
            {t.species && <span className="label-species">{t.species}</span>}
            {t.locationLabel && <span className="label-sub">{t.locationLabel}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
