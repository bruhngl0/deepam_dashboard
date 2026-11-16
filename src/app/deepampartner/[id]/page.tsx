import type { Metadata } from 'next';
import { APPOINTMENT_MAX_DAYS } from '@/lib/partners/constants';
import { addDays } from '@/lib/partners/forms';
import { activePartner } from '@/lib/partners/store';
import { todayIst } from '@/lib/queries/daily';
import { ReferralForm } from '../forms';
import { heading, page } from '../styles';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Book your visit · Deepam' };

/** A partner's referral link: deepam.com/deepampartner/<Partner ID>. The Partner ID travels with the registration. */
export default async function ReferralPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const partner = await activePartner(decodeURIComponent(id));
  if (!partner) {
    return (
      <main className={page}>
        <div className="mx-auto max-w-[720px] text-center">
          <h1 className={`${heading} mb-3`}>This link is not active</h1>
          <p>Please check the link with the person who shared it, or visit us at our MG Road or Jayanagar store.</p>
        </div>
      </main>
    );
  }
  const today = todayIst();
  const firstName = partner.fullName.split(/\s+/)[0];
  return (
    <main className={page}>
      <div className="mx-auto mb-9 max-w-[720px] text-center">
        <h1 className={`${heading} mb-4`}>Welcome to <strong className="font-bold">Deepam</strong></h1>
        <p className="mb-[1em]">{firstName} has invited you to Deepam. Tell us a little about your visit and our team will call you to confirm your appointment.</p>
        <p className="text-xs uppercase tracking-[0.08em] text-[#5c5c5c]">Deepam Partner {partner.code}</p>
      </div>
      <ReferralForm partner={partner.code} today={today} lastDay={addDays(today, APPOINTMENT_MAX_DAYS)} />
    </main>
  );
}
