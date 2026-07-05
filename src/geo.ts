/**
 * Geocoding helpers backed by OpenStreetMap public services.
 * Nominatim for forward/reverse geocoding, Overpass for finding the
 * nearest street intersection. All best-effort: failures return empty
 * results rather than throwing where a caller could be blocked.
 */

export interface PlaceResult {
  label: string;
  lat: number;
  lng: number;
}

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const OVERPASS = 'https://overpass-api.de/api/interpreter';

/** Search addresses/places, biased toward (but not limited to) the given center. */
export async function searchPlaces(
  query: string,
  center: { lat: number; lng: number },
): Promise<PlaceResult[]> {
  const viewbox = [
    center.lng - 0.2,
    center.lat + 0.2,
    center.lng + 0.2,
    center.lat - 0.2,
  ].join(',');
  const url = `${NOMINATIM}/search?format=jsonv2&limit=6&q=${encodeURIComponent(query)}&viewbox=${viewbox}&bounded=0`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('Search service unavailable — try again shortly.');
  const rows = (await res.json()) as { display_name: string; lat: string; lon: string }[];
  return rows.map((r) => ({
    label: r.display_name,
    lat: Number(r.lat),
    lng: Number(r.lon),
  }));
}

const ABBREVIATIONS: [RegExp, string][] = [
  [/\bNortheast\b/g, 'NE'],
  [/\bNorthwest\b/g, 'NW'],
  [/\bSoutheast\b/g, 'SE'],
  [/\bSouthwest\b/g, 'SW'],
  [/\bNorth\b/g, 'N'],
  [/\bSouth\b/g, 'S'],
  [/\bEast\b/g, 'E'],
  [/\bWest\b/g, 'W'],
  [/\bStreet\b/g, 'St'],
  [/\bAvenue\b/g, 'Ave'],
  [/\bBoulevard\b/g, 'Blvd'],
  [/\bDrive\b/g, 'Dr'],
  [/\bCourt\b/g, 'Ct'],
  [/\bPlace\b/g, 'Pl'],
  [/\bLane\b/g, 'Ln'],
  [/\bRoad\b/g, 'Rd'],
  [/\bTerrace\b/g, 'Ter'],
  [/\bParkway\b/g, 'Pkwy'],
  [/\bHighway\b/g, 'Hwy'],
];

function abbreviate(street: string): string {
  return ABBREVIATIONS.reduce((s, [re, abbr]) => s.replace(re, abbr), street);
}

interface OverpassNode {
  type: 'node';
  id: number;
  lat: number;
  lon: number;
}

interface OverpassWay {
  type: 'way';
  id: number;
  nodes: number[];
  tags: { name: string };
}

/** Nearest intersection of two differently-named streets, e.g. "SW Park Ave & SW Salmon St". */
async function nearestIntersection(lat: number, lng: number): Promise<string> {
  const query = `[out:json][timeout:10];way(around:120,${lat},${lng})["highway"]["name"];(._;>;);out body;`;
  let res = await fetch(OVERPASS, {
    method: 'POST',
    body: new URLSearchParams({ data: query }),
  });
  if (!res.ok) {
    // Overpass rate-limits bursts; one polite retry recovers most of them
    await new Promise((r) => setTimeout(r, 1500));
    res = await fetch(OVERPASS, { method: 'POST', body: new URLSearchParams({ data: query }) });
  }
  if (!res.ok) return '';
  const data = (await res.json()) as { elements: (OverpassNode | OverpassWay)[] };

  const nodes = new Map<number, { lat: number; lon: number }>();
  const namesAtNode = new Map<number, Set<string>>();
  for (const el of data.elements) {
    if (el.type === 'node') nodes.set(el.id, { lat: el.lat, lon: el.lon });
  }
  for (const el of data.elements) {
    if (el.type !== 'way') continue;
    for (const nodeId of el.nodes) {
      let set = namesAtNode.get(nodeId);
      if (!set) namesAtNode.set(nodeId, (set = new Set()));
      set.add(el.tags.name);
    }
  }

  let best: { dist: number; names: string[] } | null = null;
  const mPerLat = 111320;
  const mPerLng = mPerLat * Math.cos((lat * Math.PI) / 180);
  for (const [nodeId, names] of namesAtNode) {
    if (names.size < 2) continue;
    const node = nodes.get(nodeId);
    if (!node) continue;
    const dist = Math.hypot((node.lat - lat) * mPerLat, (node.lon - lng) * mPerLng);
    if (!best || dist < best.dist) best = { dist, names: [...names].sort() };
  }
  if (!best) return '';
  return best.names.slice(0, 2).map(abbreviate).join(' & ');
}

/** Reverse-geocode to the nearest street name, e.g. "near SW Salmon St". */
async function nearestStreet(lat: number, lng: number): Promise<string> {
  const url = `${NOMINATIM}/reverse?format=jsonv2&zoom=17&lat=${lat}&lon=${lng}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) return '';
  const data = (await res.json()) as { address?: { road?: string } };
  return data.address?.road ? `near ${abbreviate(data.address.road)}` : '';
}

/**
 * Human-readable location for a pin: cross streets when an intersection is
 * nearby, otherwise the nearest street. Empty string when nothing resolves —
 * callers must treat this as best-effort and never block on it.
 */
export async function locationLabel(lat: number, lng: number): Promise<string> {
  try {
    const intersection = await nearestIntersection(lat, lng);
    if (intersection) return intersection;
  } catch {
    /* fall through to reverse geocode */
  }
  try {
    return await nearestStreet(lat, lng);
  } catch {
    return '';
  }
}
