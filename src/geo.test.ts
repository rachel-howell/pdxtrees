import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { locationLabel, searchPlaces } from './geo';

// Invented streets and coordinates throughout — never real data.
const LAT = 45.52;
const LNG = -122.68;

const fetchMock = vi.fn();

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as Response;
}

/** Overpass result: named ways sharing nodes; node 1 is the nearest true intersection. */
function overpassFixture(names: [string, string]) {
  return {
    elements: [
      // ~15m from the query point: intersection of the two given streets
      { type: 'node', id: 1, lat: LAT + 0.0001, lon: LNG + 0.0001 },
      // ~120m away: a farther intersection that must lose to node 1
      { type: 'node', id: 2, lat: LAT + 0.001, lon: LNG + 0.001 },
      // on a single street only: never an intersection
      { type: 'node', id: 3, lat: LAT, lon: LNG },
      { type: 'way', id: 10, nodes: [1, 2, 3], tags: { name: names[0] } },
      { type: 'way', id: 11, nodes: [1], tags: { name: names[1] } },
      { type: 'way', id: 12, nodes: [2], tags: { name: 'Southwest Main Street' } },
    ],
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('locationLabel', () => {
  it('returns the nearest intersection of two differently-named streets, abbreviated and sorted', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(overpassFixture(['Southwest Salmon Street', 'Southwest Park Avenue'])),
    );
    expect(await locationLabel(LAT, LNG)).toBe('SW Park Ave & SW Salmon St');
    expect(fetchMock).toHaveBeenCalledTimes(1); // no reverse-geocode fallback needed
  });

  it('abbreviates directions and street types', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(overpassFixture(['North Willow Road', 'East Cedar Terrace'])),
    );
    expect(await locationLabel(LAT, LNG)).toBe('E Cedar Ter & N Willow Rd');
  });

  it('retries Overpass once after a rate-limit response', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(null, false))
      .mockResolvedValueOnce(
        jsonResponse(overpassFixture(['Southwest Salmon Street', 'Southwest Park Avenue'])),
      );
    const promise = locationLabel(LAT, LNG);
    await vi.advanceTimersByTimeAsync(1500);
    expect(await promise).toBe('SW Park Ave & SW Salmon St');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to "near <street>" when no intersection is found', async () => {
    fetchMock
      // Overpass: only same-named ways share nodes → no intersection
      .mockResolvedValueOnce(
        jsonResponse({
          elements: [
            { type: 'node', id: 1, lat: LAT, lon: LNG },
            { type: 'way', id: 10, nodes: [1], tags: { name: 'Southwest Yamhill Street' } },
          ],
        }),
      )
      // Nominatim reverse
      .mockResolvedValueOnce(jsonResponse({ address: { road: 'Southwest Yamhill Street' } }));
    expect(await locationLabel(LAT, LNG)).toBe('near SW Yamhill St');
  });

  it('falls back to reverse geocoding when Overpass fails twice', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(null, false))
      .mockResolvedValueOnce(jsonResponse(null, false))
      .mockResolvedValueOnce(jsonResponse({ address: { road: 'Southwest Taylor Street' } }));
    const promise = locationLabel(LAT, LNG);
    await vi.advanceTimersByTimeAsync(1500);
    expect(await promise).toBe('near SW Taylor St');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('never throws — returns empty string when every service is down', async () => {
    fetchMock.mockRejectedValue(new TypeError('network down'));
    expect(await locationLabel(LAT, LNG)).toBe('');
  });

  it('returns empty string when reverse geocoding has no road', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ elements: [] }))
      .mockResolvedValueOnce(jsonResponse({ address: {} }));
    expect(await locationLabel(LAT, LNG)).toBe('');
  });
});

describe('searchPlaces', () => {
  it('biases the query with a viewbox around the map center', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([{ display_name: 'Test Cafe, Portland', lat: '45.5', lon: '-122.6' }]),
    );
    const results = await searchPlaces('coffee shop', { lat: LAT, lng: LNG });

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get('q')).toBe('coffee shop');
    expect(url.searchParams.get('bounded')).toBe('0');
    const [left, top, right, bottom] = url.searchParams.get('viewbox')!.split(',').map(Number);
    expect(left).toBeCloseTo(LNG - 0.2);
    expect(top).toBeCloseTo(LAT + 0.2);
    expect(right).toBeCloseTo(LNG + 0.2);
    expect(bottom).toBeCloseTo(LAT - 0.2);

    expect(results).toEqual([{ label: 'Test Cafe, Portland', lat: 45.5, lng: -122.6 }]);
  });

  it('throws a user-facing message when the service is down', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(null, false));
    await expect(searchPlaces('anything', { lat: LAT, lng: LNG })).rejects.toThrow(/unavailable/i);
  });
});
