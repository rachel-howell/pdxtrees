import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        // Offline unit tests: all network and Supabase access is mocked.
        test: {
          name: 'unit',
          environment: 'jsdom',
          include: ['src/**/*.test.ts', 'tests/conventions.test.ts'],
        },
      },
      {
        // Read-only anon requests against the real Supabase project to verify
        // the RLS privacy boundary. Needs network; see tests/rls.test.ts.
        test: {
          name: 'rls',
          environment: 'node',
          include: ['tests/rls.test.ts'],
          testTimeout: 15000,
        },
      },
    ],
  },
});
