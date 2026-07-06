import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Tripwires for conventions that have regressed in practice (see CLAUDE.md).
 * Patterns are concatenated so a copy of this file could never match itself.
 */
const FORBIDDEN: { pattern: string; why: string }[] = [
  {
    pattern: 'toISOString().' + 'slice(',
    why: 'UTC date slicing stamps tomorrow on Portland evenings — use toLocaleDateString("en-CA")',
  },
  {
    pattern: 'window.' + 'confirm',
    why: 'native dialogs block browser automation — use inline two-step confirms',
  },
];

// vitest runs with cwd at the project root
const SRC_DIR = join(process.cwd(), 'src');

function sourceFiles(): string[] {
  return readdirSync(SRC_DIR, { recursive: true })
    .map((f) => join(SRC_DIR, String(f)))
    .filter((f) => /\.(ts|tsx)$/.test(f));
}

describe('codebase conventions', () => {
  for (const { pattern, why } of FORBIDDEN) {
    it(`src contains no "${pattern}" (${why})`, () => {
      const offenders = sourceFiles().filter((f) => readFileSync(f, 'utf8').includes(pattern));
      expect(offenders).toEqual([]);
    });
  }
});
