// One-time: signs in to Google with the OAuth client and prints a refresh token for
// GOOGLE_ADS_REFRESH_TOKEN. Sign in as a user who can see the Google Ads account.
//
//   GOOGLE_ADS_CLIENT_ID=... GOOGLE_ADS_CLIENT_SECRET=... npx tsx scripts/google-ads-refresh-token.ts
//
// The OAuth client must be of type "Desktop app" (Google Cloud → APIs & Services → Credentials).
// Nothing is saved; the token is printed once, for you to store in Secrets Manager.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

const clientId = process.env.GOOGLE_ADS_CLIENT_ID?.trim();
const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET?.trim();
if (!clientId || !clientSecret) { console.error('Set GOOGLE_ADS_CLIENT_ID and GOOGLE_ADS_CLIENT_SECRET.'); process.exit(1); }

const state = randomBytes(16).toString('hex');
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (url.pathname !== '/') { response.writeHead(404).end(); return; }
  const code = url.searchParams.get('code');
  if (url.searchParams.get('state') !== state || !code) {
    response.writeHead(400).end('Sign-in was not completed. Close this tab and run the script again.');
    console.error(url.searchParams.get('error') ?? 'Missing code or wrong state.');
    server.close(); process.exit(1);
  }
  const redirect = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  const tokens = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirect, grant_type: 'authorization_code' }),
  }).then((r) => r.json()) as { refresh_token?: string; error?: string; error_description?: string };
  response.writeHead(200, { 'Content-Type': 'text/plain' }).end(tokens.refresh_token ? 'Done. You can close this tab and go back to the terminal.' : 'No refresh token came back; see the terminal.');
  if (tokens.refresh_token) console.log(`\nGOOGLE_ADS_REFRESH_TOKEN=${tokens.refresh_token}\n\nStore it in Secrets Manager; it is not saved anywhere else.`);
  else console.error(tokens.error_description || tokens.error || 'No refresh token. Revoke the app at myaccount.google.com/permissions and try again.');
  server.close(); process.exit(tokens.refresh_token ? 0 : 1);
});

server.listen(0, '127.0.0.1', () => {
  const redirect = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  auth.search = new URLSearchParams({
    client_id: clientId, redirect_uri: redirect, response_type: 'code', state,
    scope: 'https://www.googleapis.com/auth/adwords', access_type: 'offline', prompt: 'consent',
  }).toString();
  console.log(`Open this link in your browser and sign in with the Google account that has Google Ads access:\n\n${auth}\n`);
});
