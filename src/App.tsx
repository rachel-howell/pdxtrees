import { useCallback, useEffect, useRef, useState } from 'react';
import type { Map as LeafletMap } from 'leaflet';
import {
  deleteTree,
  getAccountPrivate,
  importRecords,
  listTrees,
  setAccountPrivate,
  type Tree,
} from './db';
import { onSession, sendMagicLink, signOut, type Session } from './auth';
import { clearLegacyData, readLegacyData } from './legacy';
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
  const [session, setSession] = useState<Session | null>(null);
  const [trees, setTrees] = useState<Tree[]>([]);
  const [accountPrivate, setAccountPrivateState] = useState(true);
  const [view, setView] = useState<'map' | 'list'>('map');
  const [panel, setPanel] = useState<Panel>({ kind: 'none' });
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginState, setLoginState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [legacyCount, setLegacyCount] = useState(0);
  const [migrating, setMigrating] = useState(false);
  const mapRef = useRef<LeafletMap | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const loggedIn = session !== null;

  const refresh = useCallback(async () => {
    try {
      setTrees(await listTrees());
    } catch {
      /* offline or transient; keep current list */
    }
  }, []);

  useEffect(() => onSession(setSession), []);

  useEffect(() => {
    refresh();
    if (session) {
      getAccountPrivate().then(setAccountPrivateState).catch(() => {});
    } else {
      setPanel({ kind: 'none' });
    }
  }, [session, refresh]);

  // Offer migration whenever pre-cloud local data remains on this device
  // (merge-by-id makes importing safe even when the cloud already has data)
  useEffect(() => {
    if (loggedIn) {
      readLegacyData().then((d) => setLegacyCount(d?.trees.length ?? 0)).catch(() => {});
    } else {
      setLegacyCount(0);
    }
  }, [loggedIn, trees]);

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
    try {
      await deleteTree(id);
      await refresh();
      setPanel({ kind: 'none' });
      showToast('Tree deleted.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Delete failed.');
    }
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

  async function handleMigrate() {
    setMigrating(true);
    try {
      const legacy = await readLegacyData();
      if (legacy) {
        const { trees: t, photos: p } = await importRecords(legacy.trees, legacy.photos);
        await clearLegacyData();
        await refresh();
        showToast(`Moved ${t} tree${t === 1 ? '' : 's'} and ${p} photo${p === 1 ? '' : 's'} to the cloud.`);
      }
      setLegacyCount(0);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Migration failed.');
    } finally {
      setMigrating(false);
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginState('sending');
    try {
      await sendMagicLink(loginEmail.trim());
      setLoginState('sent');
    } catch (err) {
      setLoginState('idle');
      showToast(err instanceof Error ? err.message : 'Could not send login link.');
    }
  }

  async function handlePrivacyToggle() {
    const next = !accountPrivate;
    setAccountPrivateState(next); // optimistic
    try {
      await setAccountPrivate(next);
      showToast(next ? 'All trees are now private.' : 'Per-tree visibility settings now apply.');
    } catch (err) {
      setAccountPrivateState(!next);
      showToast(err instanceof Error ? err.message : 'Could not update privacy.');
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
                {loggedIn ? (
                  <>
                    <label className="menu-toggle">
                      <input
                        type="checkbox"
                        checked={accountPrivate}
                        onChange={handlePrivacyToggle}
                      />
                      <span>
                        Keep all trees private
                        <small>Overrides per-tree visibility</small>
                      </span>
                    </label>
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
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        signOut().then(() => showToast('Signed out.'));
                      }}
                    >
                      Sign out
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      setLoginState('idle');
                      setLoginOpen(true);
                    }}
                  >
                    Log in
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {loggedIn && legacyCount > 0 && (
        <div className="banner">
          <span>
            {legacyCount} tree{legacyCount === 1 ? '' : 's'} stored on this device from before
            cloud sync.
          </span>
          <button className="btn btn-primary" onClick={handleMigrate} disabled={migrating}>
            {migrating ? 'Moving…' : 'Move to cloud'}
          </button>
        </div>
      )}

      <main className="main">
        <MapView
          trees={trees}
          setMapRef={(m) => {
            mapRef.current = m;
          }}
          readOnly={!loggedIn}
          panelOpen={panel.kind === 'detail'}
          onDismissPanel={() => setPanel({ kind: 'none' })}
          onSelect={(treeId) => setPanel({ kind: 'detail', treeId })}
          onRequestAdd={(coords) => setPanel({ kind: 'form', coords })}
        />
        {view === 'list' && <TreeList trees={trees} onPick={pickFromList} />}
        {selectedTree && (
          <TreeDetail
            tree={selectedTree}
            accountPrivate={accountPrivate}
            readOnly={!loggedIn}
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
            accountPrivate={accountPrivate}
            onSaved={handleSaved}
            onCancel={() =>
              setPanel(panel.tree ? { kind: 'detail', treeId: panel.tree.id } : { kind: 'none' })
            }
          />
        )}
        {loginOpen && (
          <div className="modal-backdrop">
            <form className="modal login-modal" onSubmit={handleLogin}>
              <h2>Log in</h2>
              {loginState === 'sent' ? (
                <>
                  <p>
                    Check your email — we sent a login link to <strong>{loginEmail}</strong>.
                    Open it on this device.
                  </p>
                  <div className="form-actions">
                    <button type="button" className="btn" onClick={() => setLoginOpen(false)}>
                      Close
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <label>
                    Email
                    <input
                      type="email"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      placeholder="you@example.com"
                      autoFocus
                      required
                    />
                  </label>
                  <div className="form-actions">
                    <button type="button" className="btn" onClick={() => setLoginOpen(false)}>
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="btn btn-primary"
                      disabled={loginState === 'sending'}
                    >
                      {loginState === 'sending' ? 'Sending…' : 'Send login link'}
                    </button>
                  </div>
                </>
              )}
            </form>
          </div>
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
