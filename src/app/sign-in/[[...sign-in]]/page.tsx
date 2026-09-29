import Link from 'next/link';

export default function SignInPage() {
  return (
    <main className="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center gap-6 px-4 py-12">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Deepam CRM</h1>
        <p className="mt-1 text-sm text-ink-2">Authentication is temporarily disabled.</p>
      </div>
      <Link className="inline-flex items-center justify-center rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-inset focus-visible:outline-2 focus-visible:outline-accent" href="/crm">
        Open CRM
      </Link>
      <p className="max-w-[42ch] text-center text-xs leading-relaxed text-ink-muted">
        Clerk has been removed from the app for now.
      </p>
    </main>
  );
}
