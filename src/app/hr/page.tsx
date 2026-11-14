import { redirect } from 'next/navigation';

/** HR Intelligence opens on its Salespeople page. */
export default function HrPage() {
  redirect('/hr/salespeople');
}
