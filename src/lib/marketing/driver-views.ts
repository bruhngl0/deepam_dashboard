import type { Outcome } from './local';

/** Drivers desk types and views, safe to import in the browser (driver-desk.ts holds the queries). */
export const DRIVER_VIEWS = ['All', 'Not called', 'Called', 'Interested', 'Call back'] as const;
export type DriverView = (typeof DRIVER_VIEWS)[number];
export const DRIVER_PAGE_SIZE = 50;

export type DriverCall = { caller: string; outcome: Outcome; note: string; calledAt: string };
export type DriverRow = { id: number; name: string; phone: string; calls: number; last: DriverCall | null; recent: DriverCall[] };
export type DriverDesk = {
  total: number; called: number; notCalled: number; callsToday: number; myCallsToday: number | null;
  view: DriverView; filtered: number; page: number; pageSize: number; rows: DriverRow[];
};
