import type { Employee } from '@/lib/hr/employees';

/*
 * HR's employee list to Hemparshwa OS for Auth Control: employee ID, name, job title, department, store and status
 * only (no pay, bank, ID or contact details). Auth Control uses it to suggest roles by job title and to flag people
 * who have left but can still sign in; it never changes anyone's access by itself. Sent at the end of every sync.
 */

export type PeoplePush = { received: number; withLogin: number; newTitles: number };

/** What is sent for one employee: exported for tests. */
export const hrPerson = (e: Employee) => ({
  code: e.employeeCode, name: e.fullName, designation: e.designation, department: e.department,
  store: e.storeName ?? e.storeCode, status: e.status, exitDate: e.exitDate,
});

export async function pushHrPeople(): Promise<PeoplePush | null> {
  const base = process.env.HEMPARSHWA_URL?.replace(/\/+$/, '');
  const token = process.env.HEMPARSHWA_INTEGRATION_TOKEN;
  if (!base || !token) return null;
  const { listEmployees } = await import('@/lib/hr/employees');
  const employees = (await listEmployees()).map(hrPerson);
  if (!employees.length) return null;
  const res = await fetch(`${base}/api/integration/hr-people`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ employees }),
    cache: 'no-store',
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Hemparshwa /api/integration/hr-people returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as PeoplePush;
}
