/**
 * Loads .env.local for standalone scripts.
 *
 * Next.js reads .env.local automatically; `tsx` and `drizzle-kit` do not. This
 * lives in its own module because ES imports are hoisted — calling dotenv
 * inline in a script would run *after* `./index` had already read
 * process.env.DATABASE_URL and thrown. Import this first:
 *
 *   import './load-env';
 *   import { db } from './index';
 */

import { config } from 'dotenv';

config({ path: '.env.local' });
config({ path: '.env' });
