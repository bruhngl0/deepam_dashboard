import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAuthenticatedSalesperson, SALES_LOGIN_ROUTE, SALES_WORKSPACE_ROUTE, setSalespersonSession } from '@/lib/salesperson-auth';
import { authenticateSalesperson } from '@/lib/salespeople';

const button = 'inline-flex items-center justify-center rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-inset focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40';
const primary = `${button} !border-accent !bg-accent !text-white`;
const input = 'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:outline-2 focus:outline-accent';
const card = 'rounded-2xl border border-line bg-surface p-5';

async function login(formData: FormData) {
  'use server';
  const employeeNumber = String(formData.get('employeeNumber') ?? '');
  const password = String(formData.get('password') ?? '');
  const salesperson = authenticateSalesperson(employeeNumber, password);
  if (!salesperson) redirect(`${SALES_LOGIN_ROUTE}?error=1`);
  await setSalespersonSession(salesperson);
  redirect(SALES_WORKSPACE_ROUTE);
}

export default async function SalesLoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getAuthenticatedSalesperson()) redirect(SALES_WORKSPACE_ROUTE);
  const params = await searchParams;

  return <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-4 py-10">
    <form action={login} className={`${card} w-full space-y-4`}>
      <div><p className="text-xs font-semibold uppercase tracking-widest text-accent">Salesperson access</p><h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">Sales login</h1><p className="mt-2 text-sm text-ink-2">Use your employee number to open your calling desk.</p></div>
      <label className="flex flex-col gap-1.5 text-sm text-ink-2">Email ID<input name="employeeNumber" type="text" required autoComplete="username" autoFocus className={input} placeholder="DBYA0000" /></label>
      <label className="flex flex-col gap-1.5 text-sm text-ink-2">Password<input name="password" type="password" required autoComplete="current-password" className={input} /></label>
      {params.error && <p role="alert" className="text-sm text-red-600">Email ID or password is incorrect.</p>}
      <div className="flex items-center gap-2"><button className={primary}>Sign in</button><Link className={button} href="/sign-in">Admin sign in</Link></div>
    </form>
  </main>;
}
