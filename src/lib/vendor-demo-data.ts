/**
 * Temporary demonstration data for the vendor workspace.
 *
 * This is deliberately UI-only: it never mixes illustrative records into the
 * production database. Replace this module with import/query adapters once the
 * vendor workbook is agreed.
 */

export type VendorDemo = {
  id: string;
  company: string;
  brand: string;
  contact: string;
  phone: string;
  email: string;
  city: string;
  state: string;
  gstin: string;
  pan: string;
  categories: string[];
  purchasedValue: number;
  purchasedQty: number;
  soldValue: number;
  soldQty: number;
  stockValue: number;
  stockQty: number;
  agingDays: number;
  marginPct: number;
  turnDays: number;
  outstanding: number;
  overdue: number;
  returnValue: number;
  score: number;
};

export const vendorDemoData: VendorDemo[] = [
  { id: 'VND-001', company: 'Kaveri Silks Private Limited', brand: 'Kaveri Heritage', contact: 'R. Meenakshi', phone: '98450 11882', email: 'orders@kaveriheritage.in', city: 'Bengaluru', state: 'Karnataka', gstin: '29AAECK4812F1ZJ', pan: 'AAECK4812F', categories: ['Silk sarees', 'Bridal'], purchasedValue: 1842000, purchasedQty: 426, soldValue: 1564800, soldQty: 358, stockValue: 384000, stockQty: 68, agingDays: 42, marginPct: 31.6, turnDays: 38, outstanding: 324000, overdue: 0, returnValue: 18000, score: 92 },
  { id: 'VND-002', company: 'Nandini Textiles', brand: 'Nandini Weaves', contact: 'P. Arvind', phone: '98861 90413', email: 'arvind@nandiniweaves.in', city: 'Mysuru', state: 'Karnataka', gstin: '29AAFFN7421D1Z4', pan: 'AAFFN7421D', categories: ['Cotton sarees', 'Dress material'], purchasedValue: 1265000, purchasedQty: 710, soldValue: 1012000, soldQty: 574, stockValue: 253000, stockQty: 136, agingDays: 57, marginPct: 28.4, turnDays: 49, outstanding: 187000, overdue: 42000, returnValue: 12000, score: 81 },
  { id: 'VND-003', company: 'Aarna Handlooms LLP', brand: 'Aarna', contact: 'S. Karthik', phone: '99005 22177', email: 'sales@aarnahandlooms.com', city: 'Hyderabad', state: 'Telangana', gstin: '36AAXFA1337M1Z2', pan: 'AAXFA1337M', categories: ['Linen', 'Handloom'], purchasedValue: 982000, purchasedQty: 384, soldValue: 721000, soldQty: 271, stockValue: 261000, stockQty: 113, agingDays: 94, marginPct: 34.1, turnDays: 71, outstanding: 215000, overdue: 86000, returnValue: 28600, score: 68 },
  { id: 'VND-004', company: 'Saanvi Fashions', brand: 'Saanvi Studio', contact: 'N. Priya', phone: '98453 80062', email: 'priya@saanvistudio.in', city: 'Surat', state: 'Gujarat', gstin: '24AAYFS8752H1ZP', pan: 'AAYFS8752H', categories: ['Occasion wear', 'Lehengas'], purchasedValue: 1540000, purchasedQty: 202, soldValue: 1183000, soldQty: 151, stockValue: 357000, stockQty: 51, agingDays: 35, marginPct: 38.2, turnDays: 29, outstanding: 168000, overdue: 0, returnValue: 9400, score: 89 },
  { id: 'VND-005', company: 'Tirupati Fabrics', brand: 'Tirupati', contact: 'V. Suresh', phone: '97311 48809', email: 'dispatch@tirupatifabrics.in', city: 'Coimbatore', state: 'Tamil Nadu', gstin: '33AAFFT3108C1ZF', pan: 'AAFFT3108C', categories: ['Blouse material', 'Daily wear'], purchasedValue: 743000, purchasedQty: 926, soldValue: 491000, soldQty: 603, stockValue: 252000, stockQty: 323, agingDays: 118, marginPct: 23.5, turnDays: 96, outstanding: 126000, overdue: 71000, returnValue: 37000, score: 59 },
];

export const customerDemandDemo = [
  { category: 'Linen', requested: 86, fulfilled: 51, lost: 35, vendor: 'Aarna Handlooms LLP', availability: 'Low stock', opportunity: 186000 },
  { category: 'Cotton sarees', requested: 142, fulfilled: 121, lost: 21, vendor: 'Nandini Textiles', availability: 'Available', opportunity: 84000 },
  { category: 'Silk sarees', requested: 118, fulfilled: 110, lost: 8, vendor: 'Kaveri Silks Private Limited', availability: 'Available', opportunity: 64000 },
  { category: 'Blouse material', requested: 164, fulfilled: 101, lost: 63, vendor: 'Tirupati Fabrics', availability: 'Aging stock', opportunity: 126000 },
  { category: 'Occasion wear', requested: 74, fulfilled: 68, lost: 6, vendor: 'Saanvi Fashions', availability: 'Available', opportunity: 72000 },
];

export const demoPurchaseOrders = [
  { po: 'PO-2609-041', vendor: 'Kaveri Silks Private Limited', date: '12 Sep 2026', category: 'Silk sarees', amount: 486000, status: 'QC pending' },
  { po: 'PO-2609-039', vendor: 'Aarna Handlooms LLP', date: '09 Sep 2026', category: 'Linen', amount: 228000, status: 'In transit' },
  { po: 'PO-2609-034', vendor: 'Nandini Textiles', date: '05 Sep 2026', category: 'Cotton sarees', amount: 314000, status: 'Received' },
];
