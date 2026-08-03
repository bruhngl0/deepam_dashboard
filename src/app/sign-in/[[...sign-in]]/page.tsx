/**
 * Sign in.
 *
 * There is deliberately no `/sign-up` route. This is an internal tool holding
 * customer names, phone numbers and email addresses; a public sign-up page
 * would let anyone create an account and read all of it. Access is granted by
 * invitation from the Clerk dashboard, and the Clerk instance itself must be
 * set to restricted sign-up so the API cannot be used to self-register either.
 *
 * `<SignIn />` therefore gets no `signUpUrl` — the component renders without a
 * "create account" link.
 */

import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
  return (
    <main className="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center gap-6 px-4 py-12">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Deepam CRM</h1>
        <p className="mt-1 text-sm text-ink-2">Sign in to view lead-to-sale attribution.</p>
      </div>
      <SignIn />
      <p className="max-w-[42ch] text-center text-xs leading-relaxed text-ink-muted">
        Access is by invitation. If you need an account, ask an administrator to invite you.
      </p>
    </main>
  );
}
