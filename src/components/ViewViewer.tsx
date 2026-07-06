import { useEffect, useMemo, useState } from 'react';
import { ImageOverlay, MapContainer, Marker, useMapEvents } from 'react-leaflet';
import L, { type LatLng } from 'leaflet';
import {
  addMarker,
  deleteMarker,
  displayName,
  getViewImage,
  listMarkers,
  type Tree,
  type ViewMarker,
  type WindowView,
} from '../db';
import { pinIcon } from './MapView';

const STATUS_LABEL = { spotted: 'Spotted', guessed: 'Guessed', confirmed: 'Confirmed' } as const;

function TapEvents({ onTap }: { onTap: (latlng: LatLng) => void }) {
  useMapEvents({
    click: (e) => onTap(e.latlng),
    contextmenu: (e) => onTap(e.latlng),
  });
  return null;
}

interface Props {
  view: WindowView;
  trees: Tree[];
  onShowTreeOnMap: (treeId: string) => void;
  onNotify: (message: string) => void;
  onClose: () => void;
}

export default function ViewViewer({ view, trees, onShowTreeOnMap, onNotify, onClose }: Props) {
  const [imageUrl, setImageUrl] = useState<string>();
  const [size, setSize] = useState<{ w: number; h: number }>();
  const [markers, setMarkers] = useState<ViewMarker[]>([]);
  const [draft, setDraft] = useState<{ x: number; y: number } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [chipMarkerId, setChipMarkerId] = useState<string | null>(null);

  useEffect(() => {
    let url: string | undefined;
    getViewImage(view.id)
      .then(async (blob) => {
        const bitmap = await createImageBitmap(blob);
        setSize({ w: bitmap.width, h: bitmap.height });
        bitmap.close();
        url = URL.createObjectURL(blob);
        setImageUrl(url);
      })
      .catch(() => onNotify('Could not load the view image.'));
    listMarkers(view.id).then(setMarkers).catch(() => {});
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.id]);

  const bounds = useMemo(
    () => (size ? new L.LatLngBounds([-size.h, 0], [0, size.w]) : null),
    [size],
  );

  const treeById = useMemo(() => new Map(trees.map((t) => [t.id, t])), [trees]);
  const chipMarker = markers.find((m) => m.id === chipMarkerId);
  const chipTree = chipMarker ? treeById.get(chipMarker.treeId) : undefined;

  function handleTap(latlng: LatLng) {
    if (!size) return;
    if (chipMarkerId) {
      setChipMarkerId(null);
      return;
    }
    const x = Math.min(1, Math.max(0, latlng.lng / size.w));
    const y = Math.min(1, Math.max(0, -latlng.lat / size.h));
    setDraft({ x, y });
  }

  async function handlePick(tree: Tree) {
    if (!draft) return;
    try {
      const marker = await addMarker(view.id, tree.id, draft.x, draft.y);
      setMarkers((prev) => [...prev, marker]);
      setDraft(null);
      setPickerOpen(false);
      setPickerQuery('');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not add the marker.');
    }
  }

  async function handleRemoveMarker(id: string) {
    try {
      await deleteMarker(id);
      setMarkers((prev) => prev.filter((m) => m.id !== id));
      setChipMarkerId(null);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not remove the marker.');
    }
  }

  const pickerTrees = trees.filter((t) => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return true;
    return [t.commonName, t.nickname ?? '', t.species].some((s) => s.toLowerCase().includes(q));
  });

  return (
    <div className="view-viewer">
      <div className="viewer-topbar">
        <h2>{view.name}</h2>
        <span className="viewer-hint">Tap or long-press a tree in the photo to mark it</span>
        <button className="btn" onClick={onClose}>
          Close
        </button>
      </div>

      {imageUrl && bounds && size ? (
        <MapContainer
          crs={L.CRS.Simple}
          bounds={bounds}
          maxBounds={bounds.pad(0.25)}
          zoomSnap={0.25}
          minZoom={-4}
          maxZoom={3}
          zoomControl={false}
          attributionControl={false}
          className="viewer-map"
        >
          <ImageOverlay url={imageUrl} bounds={bounds} />
          <TapEvents onTap={handleTap} />
          {markers.map((m) => {
            const tree = treeById.get(m.treeId);
            return (
              <Marker
                key={m.id}
                position={[-m.y * size.h, m.x * size.w]}
                icon={pinIcon(tree?.status ?? 'spotted')}
                eventHandlers={{
                  click: () => {
                    setDraft(null);
                    setChipMarkerId(m.id);
                  },
                }}
              />
            );
          })}
          {draft && (
            <Marker position={[-draft.y * size.h, draft.x * size.w]} icon={pinIcon('draft')} />
          )}
        </MapContainer>
      ) : (
        <p className="viewer-loading">Loading view…</p>
      )}

      {draft && !pickerOpen && (
        <div className="draft-bar">
          <span className="draft-coords">Which tree is this?</span>
          <button className="btn btn-primary" onClick={() => setPickerOpen(true)}>
            Pick a tree
          </button>
          <button className="btn" onClick={() => setDraft(null)}>
            Cancel
          </button>
        </div>
      )}

      {chipMarker && (
        <div className="draft-bar">
          <span className="draft-coords">
            {chipTree ? displayName(chipTree) : 'Tree'}
            {chipTree && (
              <span className={`badge badge-${chipTree.status} chip-badge`}>
                {STATUS_LABEL[chipTree.status]}
              </span>
            )}
          </span>
          {chipTree && (
            <button className="btn btn-primary" onClick={() => onShowTreeOnMap(chipTree.id)}>
              Show on map
            </button>
          )}
          <button className="btn btn-danger-outline" onClick={() => handleRemoveMarker(chipMarker.id)}>
            Remove
          </button>
          <button className="btn" onClick={() => setChipMarkerId(null)}>
            ✕
          </button>
        </div>
      )}

      {pickerOpen && (
        <div className="modal-backdrop">
          <div className="modal picker-modal">
            <h2>Which tree is this?</h2>
            <input
              type="search"
              placeholder="Search your trees…"
              value={pickerQuery}
              onChange={(e) => setPickerQuery(e.target.value)}
              autoFocus
            />
            <ul className="tree-list picker-list">
              {pickerTrees.map((t) => (
                <li key={t.id}>
                  <button className="tree-row" onClick={() => handlePick(t)}>
                    <span className={`dot dot-${t.status}`} />
                    <span className="tree-row-main">
                      <span className="tree-row-name">{displayName(t)}</span>
                      {(t.species || t.locationLabel) && (
                        <span className="tree-row-species">
                          {[t.locationLabel, t.species].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
              {pickerTrees.length === 0 && <p className="list-empty">No matching trees.</p>}
            </ul>
            <div className="form-actions">
              <button
                className="btn"
                onClick={() => {
                  setPickerOpen(false);
                  setPickerQuery('');
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
