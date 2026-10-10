import { NextResponse, type NextRequest } from 'next/server';
import { siteGate, type GateConfig, type GateModule } from '@/lib/site-gate';

// One password per module on the hub. The hub itself, the sales and store-manager
// logins and the shared APIs open with any of them.
const overview: GateModule = { key: 'overview', label: 'Overview', password: () => process.env.GATE_PASSWORD_OVERVIEW };
const customer: GateModule = { key: 'customer', label: 'Customer Intelligence', password: () => process.env.GATE_PASSWORD_CUSTOMER };
const marketing: GateModule = { key: 'marketing', label: 'Marketing Intelligence', password: () => process.env.GATE_PASSWORD_MARKETING };
// The old in-app vendor pages; same password as the Vendor Intelligence app.
const vendor: GateModule = { key: 'vendor', label: 'Vendor Intelligence', password: () => process.env.GATE_PASSWORD_VENDOR };

const under = (pathname: string, ...prefixes: string[]) =>
  prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));

const gate: GateConfig = {
  appName: 'Deepam by Ananta',
  modules: [overview, customer, marketing, vendor],
  moduleFor(pathname) {
    // App Runner's health check, and server-to-server routes that carry their own tokens.
    if (under(pathname, '/api/health', '/api/integration', '/api/marketing/sheet-sync/cron')) return null;
    if (under(pathname, '/flow')) return overview;
    if (under(pathname, '/crm')) return customer;
    if (under(pathname, '/marketing', '/marketing-team')) return marketing;
    if (under(pathname, '/vendor')) return vendor;
    return 'any';
  },
};

export default async function proxy(req: NextRequest) {
  return (await siteGate(req, gate)) ?? NextResponse.next();
}

export const config = {
  matcher: [
    // Everything except Next internals and static files.
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
