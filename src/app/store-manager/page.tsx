import { redirect } from 'next/navigation';
import { isStoreManagerLogin, isStoreManagerSession, setStoreManagerSession, STORE_MANAGER_LOGIN_ROUTE, STORE_MANAGER_WORKSPACE_ROUTE } from '@/lib/store-manager-auth';

const input = 'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:outline-2 focus:outline-accent';
const button = 'inline-flex items-center justify-center rounded-lg border border-accent bg-accent px-3 py-2 text-sm font-medium text-white focus-visible:outline-2 focus-visible:outline-accent';
const card = 'rounded-2xl border border-line bg-surface p-5';

async function login(formData: FormData) {
  'use server';
  const username = String(formData.get('username') ?? '');
  const password = String(formData.get('password') ?? '');
  if (!isStoreManagerLogin(username, password)) redirect(`${STORE_MANAGER_LOGIN_ROUTE}?error=1`);
  await setStoreManagerSession();
  redirect(STORE_MANAGER_WORKSPACE_ROUTE);
}

export default async function StoreManagerLoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await isStoreManagerSession()) redirect(STORE_MANAGER_WORKSPACE_ROUTE);
  const params = await searchParams;
  return <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-4 py-10"><form action={login} className={`${card} w-full space-y-4`}>
    <div><p className="text-xs font-semibold uppercase tracking-widest text-accent">Store manager access</p><h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">Store manager login</h1><p className="mt-2 text-sm text-ink-2">Sign in to monitor leads and team performance.</p></div>
    <label className="flex flex-col gap-1.5 text-sm text-ink-2">Username<input name="username" required autoFocus autoComplete="username" className={input} /></label>
    <label className="flex flex-col gap-1.5 text-sm text-ink-2">Password<input name="password" type="password" required autoComplete="current-password" className={input} /></label>
    {params.error && <p role="alert" className="text-sm text-red-600">Username or password is incorrect.</p>}
    <button className={button}>Sign in</button>
  </form></main>;
}
