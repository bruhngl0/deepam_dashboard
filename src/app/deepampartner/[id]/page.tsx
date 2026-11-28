import type { Metadata } from 'next';
import { APPOINTMENT_MAX_DAYS } from '@/lib/partners/constants';
import { addDays } from '@/lib/partners/forms';
import { activePartner } from '@/lib/partners/store';
import { todayIst } from '@/lib/queries/daily';
import { ReferralForm } from '../forms';
import { frame, heading, kicker, page } from '../styles';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Book your visit · Ananta Partners' };

/** A partner's referral link: /deepampartner/<Partner ID> (APR-00001; old DPR- links still open). The Partner ID travels with the registration. */
export default async function ReferralPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const partner = await activePartner(decodeURIComponent(id));
  if (!partner) {
    return (
      <main className={page}>
        <div className="mx-auto max-w-[720px] text-center">
          <h1 className={`${heading} mb-3`}>This link is not active</h1>
          <p>Please check the link with the person who shared it.</p>
        </div>
      </main>
    );
  }
  const today = todayIst();
  const firstName = partner.fullName.split(/\s+/)[0];
  return (
    <main className={page}>
      <div className="mx-auto mb-9 max-w-[720px] text-center">
        <p className={`${kicker} mb-3`}>A personal invitation</p>
        <h1 className={`${heading} mb-4`}>Welcome to <strong className="font-bold">Ananta Partners</strong></h1>
        <p className="mb-[1em]">{firstName} has invited you. Choose the brand you&rsquo;d like to visit, Deepam or Kalaniketan, tell us a little about your visit, and our team will call you to confirm your appointment.</p>
        <p className="inline-block border border-[#e5d8c3] bg-[#faf6ef] px-3 py-1 text-xs uppercase tracking-[0.08em] text-[#5c5c5c]">Invited by Ananta Partner {partner.code}</p>
      </div>
      <div className={`${frame} mx-auto max-w-[800px]`}>
        <ReferralForm partner={partner.code} today={today} lastDay={addDays(today, APPOINTMENT_MAX_DAYS)} />
      </div>
    </main>
  );
}
