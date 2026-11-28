'use client';
import { DriverDesk } from './driver-desk';
import { button } from './marketing-shared';

/** A driver caller's desk (DRIVER_CALLERS): the Drivers list and nothing else. */
export function DriverCallerWorkspace({ name, logoutAction }: { name: string; logoutAction: () => Promise<void> }) {
  return <main className="mx-auto w-full max-w-[92rem] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted">Drivers desk</p><h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">{name} calling desk</h1><p className="mt-1 max-w-3xl text-sm text-ink-2">Call the drivers on this list and log each call.</p></div><div className="flex items-center gap-2"><a href="/sales/chat" target="_blank" rel="noopener" className={button}>Team chat</a><form action={logoutAction}><button className={button}>Sign out</button></form></div></header>
    <DriverDesk mode="sales" />
  </main>;
}
