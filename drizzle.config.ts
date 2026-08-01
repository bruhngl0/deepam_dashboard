import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// Next reads .env.local automatically; drizzle-kit and tsx scripts do not.
config({ path: '.env.local' });
config({ path: '.env' });

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});
