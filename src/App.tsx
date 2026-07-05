import { useCallback, useEffect, useRef, useState } from 'react';
import type { Map as LeafletMap } from 'leaflet';
import {
  deleteTree,
  getAccountPrivate,
  getTree,
  importRecords,
  listTrees,
  setAccountPrivate,
  type Tree,
} from './db';
import { treeIdFromHash } from './config';
import { onSession, sendMagicLink, signOut, type Session } from './auth';
import { clearLegacyData, readLegacyData } from './legacy';
import { exportData, importData } from './export';
import LabelSheet from './components/LabelSheet';
import MapView, { type SearchTarget } from './components/MapView';
import SearchPanel from './components/SearchPanel';
import TreeDetail from './components/TreeDetail';
import TreeForm from './components/TreeForm';
import TreeList from './components/TreeList';

type Panel =
  | { kind: 'none' }
  | { kind: 'detail'; treeId: string }
  | { kind: 'form'; tree?: Tree; coords: { lat: number; lng: number } };

export default function App() {
  // undefined = session not yet known; null = definitely logged out
  const [session, setSession] = useState<Session | null | undefined>(undefined);
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTarget, setSearchTarget] = useState<SearchTarget | null>(null);
  const [labelTrees, setLabelTrees] = useState<Tree[] | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const loggedIn = !!session;

  const refresh = useCallback(async () => {
    try {
      setTrees(await listTrees());
    } catch {
      /* offline or transient; keep current list */
    }
  }, []);

  useEffect(() => onSession(setSession), []);

  useEffect(() => {
    if (session === undefined) return;
    refresh();
    if (session) {
      getAccountPrivate().then(setAccountPrivateState).catch(() => {});
    } else {
      setPanel({ kind: 'none' });
    }
  }, [session, refresh]);

  // Deep links (#/tree/<id>, e.g. from a scanned QR code). RLS decides
  // visibility: a private tree resolves for its owner and looks identical
  // to a nonexistent one for everybody else.
  useEffect(() => {
    if (session === undefined) return; // wait until we know who's asking
    async function resolveHash() {
      const id = treeIdFromHash(window.location.hash);
      if (!id) return;
      const tree = await getTree(id).catch(() => null);
      if (tree) {
        setTrees((prev) => (prev.some((t) => t.id === tree.id) ? prev : [...prev, tree]));
        setView('map');
        setPanel({ kind: 'detail', treeId: tree.id });
        mapRef.current?.flyTo([tree.lat, tree.lng], Math.max(mapRef.current.getZoom(), 18));
      } else {
        showToast('Tree not found — it may be private. Log in and try again.');
        if (!session) {
          setLoginState('idle');
          setLoginOpen(true);
        }
      }
    }
    resolveHash();
    window.addEventListener('hashchange', resolveHash);
    return () => window.removeEventListener('hashchange', resolveHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Keep the URL hash in sync with the open detail so every tree view is shareable
  useEffect(() => {
    const openId = panel.kind === 'detail' ? panel.treeId : null;
    const hashId = treeIdFromHash(window.location.hash);
    if (openId && openId !== hashId) {
      history.replaceState(null, '', `#/tree/${openId}`);
    } else if (!openId && hashId) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }, [panel]);

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
            aria-label="Search places"
            onClick={() => setSearchOpen(!searchOpen)}
          >
            🔍
          </button>
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
                        setLabelTrees(trees);
                      }}
                    >
                      Print QR labels
                    </button>
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
          searchTarget={searchTarget}
          onClearSearchTarget={() => setSearchTarget(null)}
          onNotify={showToast}
          onDismissPanel={() => setPanel({ kind: 'none' })}
          onSelect={(treeId) => setPanel({ kind: 'detail', treeId })}
          onRequestAdd={(coords) => setPanel({ kind: 'form', coords })}
        />
        {view === 'list' && <TreeList trees={trees} onPick={pickFromList} />}
        {searchOpen && (
          <SearchPanel
            center={
              mapRef.current
                ? { lat: mapRef.current.getCenter().lat, lng: mapRef.current.getCenter().lng }
                : { lat: 45.5152, lng: -122.6784 }
            }
            onPick={(r) => {
              setSearchOpen(false);
              setSearchTarget(r);
              setView('map');
              mapRef.current?.flyTo([r.lat, r.lng], 18);
            }}
            onClose={() => setSearchOpen(false)}
          />
        )}
        {selectedTree && (
          <TreeDetail
            tree={selectedTree}
            accountPrivate={accountPrivate}
            readOnly={!loggedIn}
            onShowQr={() => setLabelTrees([selectedTree])}
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
        {labelTrees && <LabelSheet trees={labelTrees} onClose={() => setLabelTrees(null)} />}
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
