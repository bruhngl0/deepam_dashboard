// The store-manager login's cookie, free of `next/headers` so the proxy can set it
// when the Hemparshwa admin arrives (see site-gate.ts).
export const STORE_MANAGER_COOKIE = 'store_manager_session';
export const STORE_MANAGER_TOKEN = 'neena-store-manager-session';
export const STORE_MANAGER_COOKIE_PATH = '/store-manager';
export const STORE_MANAGER_MAX_AGE = 60 * 60 * 12;
