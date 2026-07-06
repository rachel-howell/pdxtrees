import { describe, expect, it } from 'vitest';
import { SITE_URL, treeIdFromHash, treeUrl } from './config';

const UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

describe('treeUrl', () => {
  // This exact format is printed on physical QR labels — it is frozen.
  it('builds the canonical deep link', () => {
    expect(treeUrl(UUID)).toBe(`${SITE_URL}#/tree/${UUID}`);
    expect(SITE_URL.endsWith('/')).toBe(true);
  });
});

describe('treeIdFromHash', () => {
  it('extracts a uuid from a tree hash', () => {
    expect(treeIdFromHash(`#/tree/${UUID}`)).toBe(UUID);
  });

  it('accepts uppercase hex (QR scanners may uppercase)', () => {
    expect(treeIdFromHash(`#/tree/${UUID.toUpperCase()}`)).toBe(UUID.toUpperCase());
  });

  it('rejects anything that is not exactly a 36-char uuid hash', () => {
    expect(treeIdFromHash('')).toBeNull();
    expect(treeIdFromHash('#')).toBeNull();
    expect(treeIdFromHash('#/tree/')).toBeNull();
    expect(treeIdFromHash('#/tree/not-a-uuid')).toBeNull();
    expect(treeIdFromHash(`#/tree/${UUID}extra`)).toBeNull();
    expect(treeIdFromHash(`#/tree/${UUID.slice(0, 35)}`)).toBeNull();
    expect(treeIdFromHash(`/tree/${UUID}`)).toBeNull();
    expect(treeIdFromHash(`#/trees/${UUID}`)).toBeNull();
  });
});
