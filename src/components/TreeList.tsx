import { useMemo, useState } from 'react';
import { displayName, type Confidence, type Tree, type TreeStatus } from '../db';

const STATUS_LABEL = { spotted: 'Spotted', guessed: 'Guessed', confirmed: 'Confirmed' } as const;

interface Props {
  trees: Tree[];
  onPick: (id: string) => void;
}

export default function TreeList({ trees, onPick }: Props) {
  const [query, setQuery] = useState('');
  const [confidence, setConfidence] = useState<Confidence | 'all'>('all');
  const [status, setStatus] = useState<TreeStatus | 'all'>('all');
  const [species, setSpecies] = useState('all');

  const speciesOptions = useMemo(
    () => [...new Set(trees.map((t) => t.species).filter(Boolean))].sort(),
    [trees],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return trees
      .filter((t) => {
        if (confidence !== 'all' && t.confidence !== confidence) return false;
        if (status !== 'all' && t.status !== status) return false;
        if (species !== 'all' && t.species !== species) return false;
        if (!q) return true;
        return [t.commonName, t.nickname ?? '', t.species, t.notes].some((s) =>
          s.toLowerCase().includes(q),
        );
      })
      .sort(
        (a, b) =>
          b.dateEncountered.localeCompare(a.dateEncountered) ||
          a.commonName.localeCompare(b.commonName),
      );
  }, [trees, query, confidence, species]);

  return (
    <div className="list-view">
      <div className="list-controls">
        <input
          type="search"
          placeholder="Search name, species, notes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="list-filters">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as TreeStatus | 'all')}
            aria-label="Filter by status"
          >
            <option value="all">Any status</option>
            <option value="spotted">Spotted</option>
            <option value="guessed">Guessed</option>
            <option value="confirmed">Confirmed</option>
          </select>
          <select
            value={confidence}
            onChange={(e) => setConfidence(e.target.value as Confidence | 'all')}
            aria-label="Filter by confidence"
          >
            <option value="all">Any confidence</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          {speciesOptions.length > 0 && (
            <select
              value={species}
              onChange={(e) => setSpecies(e.target.value)}
              aria-label="Filter by species"
            >
              <option value="all">Any species</option>
              {speciesOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {trees.length === 0 ? (
        <p className="list-empty">
          No trees yet — switch to the map and tap where a tree is to add your first one.
        </p>
      ) : filtered.length === 0 ? (
        <p className="list-empty">No trees match your search.</p>
      ) : (
        <ul className="tree-list">
          {filtered.map((t) => (
            <li key={t.id}>
              <button className="tree-row" onClick={() => onPick(t.id)}>
                <span className={`dot dot-${t.status}`} title={STATUS_LABEL[t.status]} />
                <span className="tree-row-main">
                  <span className="tree-row-name">{displayName(t)}</span>
                  {(t.nickname || t.species || t.locationLabel) && (
                    <span className="tree-row-species">
                      {[t.locationLabel, t.nickname ? t.commonName : '', t.species]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  )}
                </span>
                <span className="tree-row-date">{t.dateEncountered}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
