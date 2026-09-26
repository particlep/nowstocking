import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Tests run inside the Workers runtime (workerd) with a local D1, like production.
export default defineConfig(async () => {
  const migrations = await readD1Migrations(`${import.meta.dirname}/migrations`);
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            // No Access in tests: requests run as this user.
            ACCESS_TEAM_DOMAIN: '',
            ACCESS_AUD: '',
            DEV_USER_EMAIL: 'test@example.com',
          },
        },
      }),
    ],
    test: {
      include: ['test/**/*.test.ts'],
      setupFiles: ['./test/setup.ts'],
    },
  };
});
