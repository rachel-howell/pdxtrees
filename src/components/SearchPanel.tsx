import { useState } from 'react';
import { searchPlaces, type PlaceResult } from '../geo';

interface Props {
  center: { lat: number; lng: number };
  onPick: (result: PlaceResult) => void;
  onClose: () => void;
}

export default function SearchPanel({ center, onPick, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [state, setState] = useState<'idle' | 'searching' | 'done' | 'error'>('idle');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setState('searching');
    try {
      setResults(await searchPlaces(query.trim(), center));
      setState('done');
    } catch {
      setResults([]);
      setState('error');
    }
  }

  return (
    <div className="list-view search-panel">
      <form className="list-controls" onSubmit={handleSubmit}>
        <div className="search-row">
          <input
            type="search"
            placeholder="Search an address or place…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <button type="submit" className="btn btn-primary" disabled={state === 'searching'}>
            {state === 'searching' ? '…' : 'Search'}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </form>

      {state === 'error' && <p className="list-empty">Search failed — try again in a moment.</p>}
      {state === 'done' && results.length === 0 && (
        <p className="list-empty">No results — try adding a city or cross street.</p>
      )}
      <ul className="tree-list">
        {results.map((r, i) => {
          const [primary, ...rest] = r.label.split(', ');
          return (
            <li key={`${r.lat},${r.lng},${i}`}>
              <button className="tree-row" onClick={() => onPick(r)}>
                <span className="tree-row-main">
                  <span className="tree-row-name">{primary}</span>
                  <span className="tree-row-species">{rest.slice(0, 4).join(', ')}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="search-credit">Search by OpenStreetMap Nominatim</p>
    </div>
  );
}
