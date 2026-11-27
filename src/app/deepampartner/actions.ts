'use server';

import { redirect } from 'next/navigation';
import { DECLINE_MESSAGE } from '@/lib/partners/constants';
import { applyAsPartner, registerReferral } from '@/lib/partners/store';
import { partnerPath } from '@/lib/partners/site';

/** What a public form shows after a submit that did not go through. `values` refills the fields. */
export type FormState = { message: string; values: Record<string, string>; attempt: number };

const valuesOf = (form: FormData) => Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === 'string')) as Record<string, string>;

export async function applyAction(prev: FormState, form: FormData): Promise<FormState> {
  const result = await applyAsPartner((key) => form.get(key));
  if (result.kind === 'invalid') return { message: result.message, values: valuesOf(form), attempt: prev.attempt + 1 };
  redirect(await partnerPath(result.kind === 'existing' ? '/thank-you?existing=1' : '/thank-you'));
}

export async function referAction(prev: FormState, form: FormData): Promise<FormState> {
  const code = String(form.get('partner') ?? '');
  const result = await registerReferral(code, (key) => form.get(key));
  if (result.kind === 'inactive') return { message: 'This partner link is no longer active.', values: valuesOf(form), attempt: prev.attempt + 1 };
  if (result.kind === 'invalid') return { message: result.message, values: valuesOf(form), attempt: prev.attempt + 1 };
  if (result.kind === 'declined') return { message: DECLINE_MESSAGE[result.reason], values: {}, attempt: prev.attempt + 1 };
  redirect(await partnerPath(`/${encodeURIComponent(code.toUpperCase())}/thank-you`));
}
