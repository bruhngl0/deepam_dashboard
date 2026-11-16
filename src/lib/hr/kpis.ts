/**
 * Performance KPIs for each department on the employee list. `live` KPIs are worked out from data the apps
 * already hold (sales sheet, WalkTrack, CRM calls), for employees linked to a salesperson; the rest are the
 * measures HR should track, with no data source yet, and show as empty until one is connected.
 */

export type Kpi = { name: string; measure: string; live?: 'netSales' | 'bills' | 'avgBill' | 'discount' | 'conversion' | 'newCustomers' | 'returns' | 'calls' | 'connected' };

export const DEPARTMENT_KPIS: Record<string, Kpi[]> = {
  Sales: [
    { name: 'Net sales', measure: 'Sales less returns credited to them on the sales sheet', live: 'netSales' },
    { name: 'Bills', measure: 'Sales bills under their name', live: 'bills' },
    { name: 'Average bill value', measure: 'Sales ÷ bills', live: 'avgBill' },
    { name: 'Walk-in conversion rate', measure: 'Walk-ins they served marked converted ÷ walk-ins served (WalkTrack)', live: 'conversion' },
    { name: 'New customers', measure: 'Customers whose first bill was with them', live: 'newCustomers' },
    { name: 'Discount given', measure: 'Item discount as a share of the price before discount', live: 'discount' },
    { name: 'Returns', measure: 'Value of returns against their bills', live: 'returns' },
  ],
  'Marketing & CRM': [
    { name: 'Calls made', measure: 'Marketing calls logged under their name', live: 'calls' },
    { name: 'Connected calls', measure: 'Calls that got through', live: 'connected' },
    { name: 'Leads converted', measure: 'Leads they worked that bought within 30 days' },
    { name: 'Cost per lead', measure: 'Campaign spend ÷ leads, for campaigns they run' },
    { name: 'Follow-ups on time', measure: 'Follow-ups closed by their due date' },
  ],
  'E-commerce': [
    { name: 'Online sales', measure: 'Net sales of the Online store' },
    { name: 'Products listed', measure: 'New products made live in the month' },
    { name: 'Order dispatch time', measure: 'Hours from order to dispatch' },
    { name: 'Return rate', measure: 'Online orders returned ÷ orders' },
  ],
  'Finance & Accounts': [
    { name: 'Books closed on time', measure: 'Month-end close by the agreed day' },
    { name: 'Cash variance', measure: 'Counter cash short or over against the day’s bills' },
    { name: 'Vendor payments on time', measure: 'Bills paid by their due date' },
    { name: 'Billing errors', measure: 'Bills cancelled or corrected' },
  ],
  'Human Resources & Administration': [
    { name: 'Attendance', measure: 'Days present ÷ working days, company-wide' },
    { name: 'Attrition', measure: 'Exits in the month ÷ head count' },
    { name: 'Time to hire', measure: 'Days from opening to joining' },
    { name: 'Records complete', measure: 'Employees with every HR record filled' },
  ],
  'Inventory & Warehouse': [
    { name: 'Stock accuracy', measure: 'Counted stock matching the system' },
    { name: 'Inward to shelf', measure: 'Days from goods received to ready for sale' },
    { name: 'QC rejections', measure: 'Pieces rejected at QC ÷ pieces received' },
    { name: 'Aged stock', measure: 'Stock older than 90 days, at cost' },
  ],
  'IT & Technology': [
    { name: 'System uptime', measure: 'Share of store hours every app was up' },
    { name: 'Issues resolved', measure: 'Staff issues closed within a day' },
    { name: 'Automations shipped', measure: 'Processes moved off manual work' },
  ],
  Operations: [
    { name: 'Packing turnaround', measure: 'Orders packed the same day' },
    { name: 'Alteration turnaround', measure: 'Days from order to alteration ready' },
    { name: 'Store readiness', measure: 'Store-opening checklist done on time' },
  ],
  Procurement: [
    { name: 'Sell-through', measure: 'Units sold in 30 days ÷ (those + units in stock)' },
    { name: 'Purchase margin', measure: 'Margin on goods bought in the month' },
    { name: 'Vendor delivery on time', measure: 'Orders received by the promised date' },
  ],
  'Security & Facilities': [
    { name: 'Incidents', measure: 'Security incidents in the month' },
    { name: 'Housekeeping checks', measure: 'Checklists done ÷ due' },
    { name: 'Valet turnaround', measure: 'Minutes to bring a car' },
  ],
};

export const kpisFor = (department: string | null): Kpi[] => (department ? DEPARTMENT_KPIS[department] ?? [] : []);
