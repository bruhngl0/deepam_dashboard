import { callLog, salespersonPerformance, type CallEntry, type Dataset, type ExistingClaim } from './local';

/**
 * One salesperson's performance, worked out exactly as Team performance does: the shared call records plus calls on
 * the leads, their campaign leads plus their claimed existing and online customers. With from/to, calls, interested,
 * conversions and sales count only that period.
 */
export function performanceFor(data: Dataset, salesperson: string, from: string, to: string, stored: CallEntry[], claims: ExistingClaim[]) {
  const all = callLog([data], stored);
  const calls = all.filter(call => (!from || call.at.slice(0, 10) >= from) && (!to || call.at.slice(0, 10) <= to));
  return salespersonPerformance(data, calls, [salesperson], claims, { from, to, allCalls: all })[0];
}
