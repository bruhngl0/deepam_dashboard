import { redirect } from 'next/navigation';
import Link from 'next/link';
import { SalespersonMarketingWorkspace } from '@/components/salesperson-marketing-workspace';
import { abishekCredentials, ABISHEK_ROUTE, isAbishekLogin, isAbishekSession, setAbishekSession } from '@/lib/salesperson-auth';

type SearchParams = Promise<{ error?: string }>;
const button = 'inline-flex items-center justify-center rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-inset focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40';
const primary = `${button} !bg-accent !text-white !border-accent`;
const input = 'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:outline-2 focus:outline-accent';
const card = 'rounded-2xl border border-line bg-surface p-5';

async function login(formData: FormData) {
  'use server';
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  if (!isAbishekLogin(email, password)) redirect(`${ABISHEK_ROUTE}?error=1`);
  await setAbishekSession();
  redirect(ABISHEK_ROUTE);
}

export default async function AbishekSalesPage({ searchParams }: { searchParams: SearchParams }) {
  if (await isAbishekSession()) return <SalespersonMarketingWorkspace />;
  const params = await searchParams;
  const credentials = abishekCredentials();
  return <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-4 py-10">
    <form action={login} className={`${card} w-full space-y-4`}>
      <div><p className="text-xs font-semibold uppercase tracking-widest text-accent">Salesperson access</p><h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">Abishek calling desk</h1><p className="mt-2 text-sm text-ink-2">Sign in to view calling queue and follow-ups.</p></div>
      <label className="flex flex-col gap-1.5 text-sm text-ink-2">Email<input name="email" type="email" required autoComplete="email" defaultValue={credentials.email} className={input} /></label>
      <label className="flex flex-col gap-1.5 text-sm text-ink-2">Password<input name="password" type="password" required autoComplete="current-password" className={input} /></label>
      {params.error && <p role="alert" className="text-sm text-red-600">Email or password is incorrect.</p>}
      <div className="flex items-center gap-2"><button className={primary}>Sign in</button><Link className={button} href="/sign-in">Admin sign in</Link></div>
    </form>
  </main>;
}
