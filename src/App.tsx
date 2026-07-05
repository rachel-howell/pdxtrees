import { useCallback, useEffect, useRef, useState } from 'react';
import type { Map as LeafletMap } from 'leaflet';
import { deleteTree, listTrees, type Tree } from './db';
import { exportData, importData } from './export';
import MapView from './components/MapView';
import TreeDetail from './components/TreeDetail';
import TreeForm from './components/TreeForm';
import TreeList from './components/TreeList';

type Panel =
  | { kind: 'none' }
  | { kind: 'detail'; treeId: string }
  | { kind: 'form'; tree?: Tree; coords: { lat: number; lng: number } };

export default function App() {
  const [trees, setTrees] = useState<Tree[]>([]);
  const [view, setView] = useState<'map' | 'list'>('map');
  const [panel, setPanel] = useState<Panel>({ kind: 'none' });
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState('');
  const mapRef = useRef<LeafletMap | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const refresh = useCallback(async () => setTrees(await listTrees()), []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  function showToast(message: string) {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 4000);
  }

  const selectedTree =
    panel.kind === 'detail' ? trees.find((t) => t.id === panel.treeId) : undefined;

  function pickFromList(id: string) {
    const tree = trees.find((t) => t.id === id);
    setView('map');
    setPanel({ kind: 'detail', treeId: id });
    if (tree) mapRef.current?.flyTo([tree.lat, tree.lng], Math.max(mapRef.current.getZoom(), 18));
  }

  async function handleDelete(id: string) {
    await deleteTree(id);
    await refresh();
    setPanel({ kind: 'none' });
    showToast('Tree deleted.');
  }

  async function handleSaved(treeId: string) {
    await refresh();
    setPanel({ kind: 'detail', treeId });
  }

  async function handleImport(file: File) {
    try {
      const { trees: t, photos: p } = await importData(file);
      await refresh();
      showToast(`Imported ${t} tree${t === 1 ? '' : 's'} and ${p} photo${p === 1 ? '' : 's'}.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Import failed.');
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>🌳 PDX Trees</h1>
        <span className="tree-count">{trees.length}</span>
        <div className="topbar-actions">
          <button
            className="btn btn-topbar"
            onClick={() => setView(view === 'map' ? 'list' : 'map')}
          >
            {view === 'map' ? 'List' : 'Map'}
          </button>
          <div className="menu-wrap">
            <button
              className="btn btn-topbar"
              aria-label="Menu"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              ⋯
            </button>
            {menuOpen && (
              <div className="menu">
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    exportData().then(
                      () => showToast('Backup downloaded.'),
                      () => showToast('Export failed.'),
                    );
                  }}
                >
                  Export backup
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    importInputRef.current?.click();
                  }}
                >
                  Import backup
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="main">
        <MapView
          trees={trees}
          setMapRef={(m) => {
            mapRef.current = m;
          }}
          panelOpen={panel.kind === 'detail'}
          onDismissPanel={() => setPanel({ kind: 'none' })}
          onSelect={(treeId) => setPanel({ kind: 'detail', treeId })}
          onRequestAdd={(coords) => setPanel({ kind: 'form', coords })}
        />
        {view === 'list' && <TreeList trees={trees} onPick={pickFromList} />}
        {selectedTree && (
          <TreeDetail
            tree={selectedTree}
            onClose={() => setPanel({ kind: 'none' })}
            onEdit={() =>
              setPanel({
                kind: 'form',
                tree: selectedTree,
                coords: { lat: selectedTree.lat, lng: selectedTree.lng },
              })
            }
            onDelete={() => handleDelete(selectedTree.id)}
          />
        )}
        {panel.kind === 'form' && (
          <TreeForm
            tree={panel.tree}
            coords={panel.coords}
            onSaved={handleSaved}
            onCancel={() =>
              setPanel(panel.tree ? { kind: 'detail', treeId: panel.tree.id } : { kind: 'none' })
            }
          />
        )}
      </main>

      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleImport(file);
          e.target.value = '';
        }}
      />

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
