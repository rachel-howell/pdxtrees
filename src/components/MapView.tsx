import { useRef, useState } from 'react';
import { Circle, MapContainer, Marker, TileLayer, useMapEvents } from 'react-leaflet';
import L, { type LatLng, type Map as LeafletMap } from 'leaflet';
import type { Tree, TreeStatus } from '../db';

const VIEW_KEY = 'pdxtrees:mapview';
const DEFAULT_VIEW = { lat: 45.5152, lng: -122.6784, zoom: 16 }; // Portland

function loadView(): typeof DEFAULT_VIEW {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (raw) return { ...DEFAULT_VIEW, ...JSON.parse(raw) };
  } catch {
    /* fall through to default */
  }
  return DEFAULT_VIEW;
}

const iconCache = new Map<string, L.DivIcon>();

export function pinIcon(kind: TreeStatus | 'draft' | 'search' | 'self'): L.DivIcon {
  let icon = iconCache.get(kind);
  if (!icon) {
    icon = L.divIcon({
      className: '',
      html: `<div class="pin pin-${kind}"></div>`,
      iconSize: [26, 26],
      iconAnchor: [13, 13],
    });
    iconCache.set(kind, icon);
  }
  return icon;
}

/** Captures map taps (click, and contextmenu = mobile long-press / right-click). */
function MapEvents({ onTap }: { onTap: (latlng: LatLng) => void }) {
  const map = useMapEvents({
    click: (e) => onTap(e.latlng),
    contextmenu: (e) => onTap(e.latlng),
    moveend: () => {
      const c = map.getCenter();
      localStorage.setItem(
        VIEW_KEY,
        JSON.stringify({ lat: c.lat, lng: c.lng, zoom: map.getZoom() }),
      );
    },
  });
  return null;
}

export interface SearchTarget {
  lat: number;
  lng: number;
  label: string;
}

interface Props {
  trees: Tree[];
  setMapRef: (map: LeafletMap | null) => void;
  /** Logged-out visitors can browse but not drop pins. */
  readOnly: boolean;
  /** When a panel is open, a map tap dismisses it instead of dropping a draft pin. */
  panelOpen: boolean;
  searchTarget: SearchTarget | null;
  onClearSearchTarget: () => void;
  onNotify: (message: string) => void;
  onDismissPanel: () => void;
  onSelect: (id: string) => void;
  onRequestAdd: (coords: { lat: number; lng: number }) => void;
}

export default function MapView({
  trees,
  setMapRef,
  readOnly,
  panelOpen,
  searchTarget,
  onClearSearchTarget,
  onNotify,
  onDismissPanel,
  onSelect,
  onRequestAdd,
}: Props) {
  const [initialView] = useState(loadView);
  const [draft, setDraft] = useState<{ lat: number; lng: number } | null>(null);
  const [self, setSelf] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const mapInstance = useRef<LeafletMap | null>(null);

  function handleTap(latlng: LatLng) {
    if (panelOpen) {
      onDismissPanel();
      setDraft(null);
    } else if (!readOnly) {
      setDraft({ lat: latlng.lat, lng: latlng.lng });
    }
  }

  function locateMe() {
    if (!navigator.geolocation) {
      onNotify('Location is not available in this browser.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const loc = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        };
        setSelf(loc);
        mapInstance.current?.flyTo(
          [loc.lat, loc.lng],
          Math.max(mapInstance.current.getZoom(), 17),
        );
      },
      (err) => {
        setLocating(false);
        onNotify(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission denied — allow it in your browser settings.'
            : 'Could not get your location.',
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  }

  return (
    <div className="map-wrap">
      <MapContainer
        ref={(m) => {
          mapInstance.current = m;
          setMapRef(m);
        }}
        center={[initialView.lat, initialView.lng]}
        zoom={initialView.zoom}
        maxZoom={21}
        zoomControl={false}
        className="map"
      >
        {/* World imagery underneath; high-res leaf-on Oregon imagery (OSIP) on top.
            Where OSIP has no tiles (outside Oregon), Esri shows through. */}
        <TileLayer
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          attribution="Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics"
          maxNativeZoom={19}
          maxZoom={21}
        />
        <TileLayer
          url="https://imagery.oregonexplorer.info/arcgis/rest/services/OSIP_2022/OSIP_2022_WM/ImageServer/tile/{z}/{y}/{x}"
          attribution="Imagery: Oregon Statewide Imagery Program"
          maxNativeZoom={19}
          maxZoom={21}
        />
        <MapEvents onTap={handleTap} />
        {trees.map((tree) => (
          <Marker
            key={tree.id}
            position={[tree.lat, tree.lng]}
            icon={pinIcon(tree.status)}
            eventHandlers={{ click: () => onSelect(tree.id) }}
          />
        ))}
        {draft && <Marker position={[draft.lat, draft.lng]} icon={pinIcon('draft')} />}
        {searchTarget && (
          <Marker position={[searchTarget.lat, searchTarget.lng]} icon={pinIcon('search')} />
        )}
        {self && (
          <>
            <Circle
              center={[self.lat, self.lng]}
              radius={self.accuracy}
              pathOptions={{ color: '#3b82f6', weight: 1, fillOpacity: 0.12 }}
            />
            <Marker position={[self.lat, self.lng]} icon={pinIcon('self')} />
          </>
        )}
      </MapContainer>
      <button
        className="locate-btn"
        aria-label="Show my location"
        title="Show my location"
        onClick={locateMe}
        disabled={locating}
      >
        {locating ? '…' : '◎'}
      </button>
      {searchTarget && !draft && (
        <div className="draft-bar">
          <span className="draft-coords">{searchTarget.label}</span>
          <button className="btn" onClick={onClearSearchTarget}>
            ✕
          </button>
        </div>
      )}
      {draft && (
        <div className="draft-bar">
          <span className="draft-coords">
            {draft.lat.toFixed(5)}, {draft.lng.toFixed(5)}
          </span>
          <button
            className="btn btn-primary"
            onClick={() => {
              onRequestAdd(draft);
              setDraft(null);
            }}
          >
            Add tree here
          </button>
          <button className="btn" onClick={() => setDraft(null)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
