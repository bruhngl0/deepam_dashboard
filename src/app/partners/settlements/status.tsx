import { SETTLEMENT_LABEL, type SettlementStatus } from '@/lib/partners/program';
import { Pill } from '../ui';

const TONE: Record<SettlementStatus, 'good' | 'wait' | 'info' | 'bad' | 'quiet'> = {
  pending_verification: 'wait', verified: 'quiet', pending_approval: 'info', approved: 'info', on_hold: 'bad', partially_paid: 'wait', paid: 'good', adjusted: 'quiet',
};
export const SettlementBadge = ({ status }: { status: SettlementStatus }) => <Pill tone={TONE[status]}>{SETTLEMENT_LABEL[status]}</Pill>;
