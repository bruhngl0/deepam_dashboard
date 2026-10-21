/**
 * Password gate in front of the whole app, run from the proxy. Every page and API
 * route needs the password of the module it belongs to. The sign-in form lives at
 * GATE_PATH and is served by the gate itself, so no page code is involved.
 *
 * Passwords come from environment variables, read through each module's `password`
 * function (static `process.env.X` references, which edge middleware needs). In
 * production a module with no password stays locked; in development it is open.
 *
 * The Hemparshwa OS admin skips every password: Hemparshwa's /go link sends them to
 * ADMIN_PASS_PATH with a pass signed with ADMIN_SSO_SECRET (shared with Hemparshwa),
 * valid for one minute and for this app's origin only. A good pass sets the cookie of
 * every module, plus the app's own admin or staff logins (`adminCookies`), and keeps a signed admin
 * session (30 days, renewed on use) so those logins are renewed before they lapse and the admin
 * never sees a password here. GO_PATH sends a signed-in admin on to another Deepam app with a
 * fresh pass, so moving between the apps needs no password either.
 *
 * The same file is copied into CRM, Vendor Intelligence, RC Dashboard and WalkTrack;
 * keep the copies identical.
 */

import { NextResponse, type NextRequest } from 'next/server';

export type GateModule = { key: string; label: string; password: () => string | undefined };

/** A cookie for one of the app's own logins. `path` defaults to '/'. */
export type GateCookie = { name: string; value: string; path?: string; maxAge: number };

export type GateConfig = {
  /** Name on the sign-in form when any module's password will do. */
  appName: string;
  modules: GateModule[];
  /** A module, 'any' (any module's password works) or null (open, e.g. health and server-to-server routes). */
  moduleFor: (pathname: string) => GateModule | 'any' | null;
  /** The app's own logins (admin, staff, store counters) to sign the Hemparshwa admin in to as well. */
  adminCookies?: () => GateCookie[] | Promise<GateCookie[]>;
  /** Origins of the other Deepam apps this one links to through GO_PATH. */
  peers?: string[];
};

export const GATE_PATH = '/__gate';
export const ADMIN_PASS_PATH = '/__gate/admin';
/** Opens another Deepam app, signed in for an admin (see goToPeer). */
export const GO_PATH = '/__gate/go';
const MAX_AGE = 60 * 60 * 12;
// The admin session: renewed on use, so it ends only after 30 days without opening the app.
const ADMIN_COOKIE = 'gate_admin';
const ADMIN_MAX_AGE = 60 * 60 * 24 * 30;
// Marks the app's logins as recently renewed for the admin; when it lapses they are renewed again.
const FRESH_COOKIE = 'gate_admin_fresh';
const FRESH_MAX_AGE = 60 * 60;
const PASS_SECONDS = 60;
const encoder = new TextEncoder();

async function sha256(text: string) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

// Compares digests, so the time taken says nothing about the secret.
async function same(a: string, b: string) {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

const cookieName = (m: GateModule) => `gate_${m.key}`;
const tokenFor = async (m: GateModule, password: string) => hex(await sha256(`site-gate:${m.key}:${password}`));

/** undefined: open (development without a password); null: locked. */
function passwordOf(m: GateModule): string | null | undefined {
  const value = m.password();
  if (value) return value;
  return process.env.NODE_ENV === 'production' ? null : undefined;
}

async function signedIn(req: NextRequest, m: GateModule) {
  const password = passwordOf(m);
  if (password === undefined) return true;
  if (password === null) return false;
  const cookie = req.cookies.get(cookieName(m))?.value;
  return !!cookie && (await same(cookie, await tokenFor(m, password)));
}

// Only same-site paths, so the form cannot be used to bounce people elsewhere.
const safeNext = (next: unknown) =>
  typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/';

// Proxy redirects must be absolute. Behind App Runner the request reaches Next over
// plain HTTP on an internal address, so the public origin comes from the forwarded headers.
function publicOrigin(req: NextRequest) {
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0].trim() || req.nextUrl.protocol.replace(':', '');
  const host = req.headers.get('x-forwarded-host')?.split(',')[0].trim() || req.headers.get('host') || req.nextUrl.host;
  return `${proto}://${host}`;
}

function redirect(req: NextRequest, path: string, headers: Record<string, string> = {}) {
  return new NextResponse(null, {
    status: 303,
    headers: { Location: new URL(path, publicOrigin(req)).toString(), 'Cache-Control': 'no-store', ...headers },
  });
}

function setCookie(c: GateCookie) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${c.name}=${c.value}; Path=${c.path ?? '/'}; Max-Age=${c.maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function form(cfg: GateConfig, key: string, next: string, failed: boolean) {
  const chosen = cfg.modules.find((m) => m.key === key);
  const title = chosen ? chosen.label : cfg.appName;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} · Sign in</title><meta name="robots" content="noindex">
<style>
:root{--bg:#f6f6f4;--card:#fff;--ink:#1b1b1a;--ink2:#5d5d58;--line:#dedcd6;--accent:#4b5bd6;--bad:#b3261e}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--card:#1e1e1c;--ink:#efeee9;--ink2:#a4a39c;--line:#34332f;--accent:#8794ff;--bad:#ff8a80}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,sans-serif;padding:16px}
form{width:100%;max-width:22rem;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:28px}
h1{margin:0 0 4px;font-size:20px;font-weight:600}p{margin:0 0 20px;color:var(--ink2);font-size:14px}
label{display:block;font-size:13px;font-weight:500;margin-bottom:6px}
input{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:transparent;color:inherit;font:inherit}
input:focus{outline:2px solid var(--accent);outline-offset:1px}
button{margin-top:16px;width:100%;padding:10px;border:0;border-radius:10px;background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer}
.err{color:var(--bad);font-size:13px;margin:10px 0 0}
</style></head><body>
<form method="post" action="${GATE_PATH}">
<h1>${escape(title)}</h1><p>Enter the password to continue.</p>
<input type="hidden" name="m" value="${escape(chosen ? chosen.key : 'any')}">
<input type="hidden" name="next" value="${escape(next)}">
<label for="password">Password</label>
<input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
${failed ? '<p class="err" role="alert">That password is not right.</p>' : ''}
<button type="submit">Continue</button>
</form></body></html>`;
  return new NextResponse(html, {
    status: failed ? 401 : 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  });
}

async function signIn(req: NextRequest, cfg: GateConfig) {
  let data: FormData;
  try {
    data = await req.formData();
  } catch {
    return redirect(req, GATE_PATH);
  }
  const key = String(data.get('m') ?? '');
  const next = safeNext(data.get('next'));
  const given = String(data.get('password') ?? '');
  const candidates = key === 'any' ? cfg.modules : cfg.modules.filter((m) => m.key === key);

  for (const m of candidates) {
    const password = passwordOf(m);
    if (!password || !given || !(await same(given, password))) continue;
    return redirect(req, next, { 'Set-Cookie': setCookie({ name: cookieName(m), value: await tokenFor(m, password), maxAge: MAX_AGE }) });
  }
  // Slows down guessing.
  await new Promise((resolve) => setTimeout(resolve, 600));
  return form(cfg, key, next, true);
}

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function hmac(secret: string, data: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(data))));
}

const fromBase64url = (text: string) => {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
  return new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)));
};
const ssoSecret = () => {
  const secret = process.env.ADMIN_SSO_SECRET;
  return secret && secret.length >= 32 ? secret : null;
};

type AdminClaims = { sub: string; name: string; role: 'admin'; aud?: string; exp: number };

/** `<base64url JSON>.<base64url HMAC-SHA256 of the first part>` under ADMIN_SSO_SECRET; null when forged, expired or not an admin. */
async function readSigned(token: string | null | undefined): Promise<AdminClaims | null> {
  const secret = ssoSecret();
  if (!secret || !token) return null;
  const [body, signature] = token.split('.');
  if (!body || !signature || !(await same(signature, await hmac(secret, body)))) return null;
  try {
    const claims = JSON.parse(fromBase64url(body));
    return claims.role === 'admin' && Number(claims.exp) * 1000 > Date.now() ? { ...claims, sub: String(claims.sub ?? ''), name: String(claims.name ?? '') } : null;
  } catch {
    return null;
  }
}

async function signed(claims: AdminClaims) {
  const body = base64url(encoder.encode(JSON.stringify(claims)));
  return `${body}.${await hmac(ssoSecret()!, body)}`;
}

/** A pass, minted by Hemparshwa's /go or by another Deepam app's GO_PATH: one minute, for this app only. */
async function adminPassValid(req: NextRequest, pass: string | null) {
  const claims = await readSigned(pass);
  // Short-lived and for this app only, so a pass seen in a log or history is soon worthless.
  return claims && claims.aud === publicOrigin(req) && claims.exp * 1000 < Date.now() + 5 * 60_000 ? claims : null;
}

/** The admin session this app keeps once a pass has been accepted (see ADMIN_COOKIE). */
const adminSession = (req: NextRequest) => readSigned(req.cookies.get(ADMIN_COOKIE)?.value);

/** Every cookie that signs the admin in here: each module, the app's own logins, the admin session and the freshness marker. */
async function adminCookies(cfg: GateConfig, claims: AdminClaims): Promise<GateCookie[]> {
  const cookies: GateCookie[] = [];
  for (const m of cfg.modules) {
    const password = passwordOf(m);
    if (password) cookies.push({ name: cookieName(m), value: await tokenFor(m, password), maxAge: MAX_AGE });
  }
  cookies.push(...((await cfg.adminCookies?.()) ?? []));
  const session: AdminClaims = { sub: claims.sub, name: claims.name, role: 'admin', exp: Math.floor(Date.now() / 1000) + ADMIN_MAX_AGE };
  cookies.push({ name: ADMIN_COOKIE, value: await signed(session), maxAge: ADMIN_MAX_AGE });
  cookies.push({ name: FRESH_COOKIE, value: '1', maxAge: FRESH_MAX_AGE });
  return cookies;
}

function withCookies(response: NextResponse, cookies: GateCookie[]) {
  for (const c of cookies) response.headers.append('Set-Cookie', setCookie(c));
  return response;
}

async function adminSignIn(req: NextRequest, cfg: GateConfig) {
  const params = req.nextUrl.searchParams;
  const next = safeNext(params.get('next'));
  const claims = await adminPassValid(req, params.get('t'));
  // A bad or expired pass falls back to the ordinary password form.
  if (!claims) return redirect(req, `${GATE_PATH}?${new URLSearchParams({ m: 'any', next })}`);
  return withCookies(redirect(req, next), await adminCookies(cfg, claims));
}

/**
 * Opens another Deepam app (cfg.peers). A signed-in admin goes through that app's
 * ADMIN_PASS_PATH with a one-minute pass for it, so they arrive signed in there too;
 * anyone else is sent to the app as is and meets its own password.
 */
async function goToPeer(req: NextRequest, cfg: GateConfig) {
  let target: URL;
  try {
    target = new URL(req.nextUrl.searchParams.get('to') ?? '');
  } catch {
    return new NextResponse('Unknown app', { status: 400 });
  }
  if (!(cfg.peers ?? []).includes(target.origin)) return new NextResponse('Unknown app', { status: 400 });
  const session = await adminSession(req);
  let location = target.toString();
  if (session) {
    const pass = await signed({ sub: session.sub, name: session.name, role: 'admin', aud: target.origin, exp: Math.floor(Date.now() / 1000) + PASS_SECONDS });
    location = `${target.origin}${ADMIN_PASS_PATH}?${new URLSearchParams({ t: pass, next: target.pathname + target.search })}`;
  }
  return new NextResponse(null, { status: 303, headers: { Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}

/** Returns the response to send instead of the page, or null to let the request through. */
export async function siteGate(req: NextRequest, cfg: GateConfig): Promise<NextResponse | null> {
  const { pathname, search } = req.nextUrl;
  if (pathname === ADMIN_PASS_PATH && req.method === 'GET') return adminSignIn(req, cfg);
  if (pathname === GO_PATH && req.method === 'GET') return goToPeer(req, cfg);
  if (pathname === GATE_PATH) {
    if (req.method === 'POST') return signIn(req, cfg);
    const params = req.nextUrl.searchParams;
    return form(cfg, params.get('m') ?? 'any', safeNext(params.get('next')), false);
  }

  // An admin signed in once (from Hemparshwa) never meets a password here: about once an hour,
  // on a page view, every login of this app is renewed and the admin session slides forward.
  const session = await adminSession(req);
  const page = (req.method === 'GET' || req.method === 'HEAD') && !pathname.startsWith('/api/');
  if (session && page && !req.cookies.get(FRESH_COOKIE)) {
    return withCookies(redirect(req, pathname + search), await adminCookies(cfg, session));
  }

  const need = cfg.moduleFor(pathname);
  if (!need) return null;
  if (session) return null;
  for (const m of need === 'any' ? cfg.modules : [need]) if (await signedIn(req, m)) return null;

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
  const params = new URLSearchParams({ m: need === 'any' ? 'any' : need.key, next: pathname + search });
  return redirect(req, `${GATE_PATH}?${params}`);
}
