/**
 * Route protection.
 *
 * This is `proxy.ts`, not `middleware.ts`: Next.js 16 renamed the convention and
 * deprecated the old filename. The proxy runtime is `nodejs` and cannot be
 * configured — the `edge` runtime is not supported here.
 *
 * Everything is closed by default. `isPublic` lists the only routes reachable
 * signed out, so adding a page cannot accidentally expose it — a new route is
 * protected unless someone deliberately writes it into that matcher.
 *
 * Per the Next.js guidance, this is an *optimistic* check: it exists to redirect
 * a signed-out visitor rather than to be the authorisation boundary. The real
 * check runs server-side in each page via `requireUser()` (see `lib/auth.ts`),
 * so a route that somehow slipped past this matcher still cannot render data.
 */

import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isPublic = createRouteMatcher(['/sign-in(.*)']);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublic(req)) await auth.protect();
});

export const config = {
  matcher: [
    // Everything except Next internals and static files.
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
