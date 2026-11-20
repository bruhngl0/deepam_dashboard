export type Salesperson = {
  employeeNumber: string;
  name: string;
  slug: string;
  /** A shared desk's own password; people sign in with Ananta + the last four digits of their number. */
  password?: string;
};

export const SALESPEOPLE = [
  { employeeNumber: 'DBYA0033', name: 'Abhishek Thapa', slug: 'abishek' },
  { employeeNumber: 'DBYA0035', name: 'Amrutha C', slug: 'amrutha' },
  { employeeNumber: 'DBYA0023', name: 'Anil Kumar Sharma', slug: 'anil-kumar-sharma' },
  { employeeNumber: 'DBYA0024', name: 'Anuradha', slug: 'anuradha' },
  { employeeNumber: 'DBYA0034', name: 'Charita Reddy', slug: 'charita-reddy' },
  { employeeNumber: 'DBYA0025', name: 'Jyothi Damodar', slug: 'jyothi-damodar' },
  { employeeNumber: 'DBYA0098', name: 'Kalaivani', slug: 'kalaivani' },
  { employeeNumber: 'DBYA0045', name: 'Kavya S', slug: 'kavya-s' },
  { employeeNumber: 'DBYA0018', name: 'Komalavelli', slug: 'komalavelli' },
  { employeeNumber: 'DBYA0012', name: 'Krishna V N', slug: 'krishna-v-n' },
  { employeeNumber: 'DBYA0026', name: 'M V Raju', slug: 'm-v-raju' },
  { employeeNumber: 'DBYA0017', name: 'Margaret Prema', slug: 'margaret-prema' },
  { employeeNumber: 'DBYA0013', name: 'Mary Josephine', slug: 'mary-josephine' },
  { employeeNumber: 'DBYA0014', name: 'Padma H', slug: 'padma-h' },
  { employeeNumber: 'DBYA0019', name: 'Pramila N V', slug: 'pramila-n-v' },
  { employeeNumber: 'DBYA0016', name: 'Prathiba S', slug: 'prathiba-s' },
  { employeeNumber: 'DBYA0022', name: 'Ranjini B', slug: 'ranjini-b' },
  { employeeNumber: 'DBYA0020', name: 'Roopa S', slug: 'roopa-s' },
  { employeeNumber: 'DBYA0097', name: 'Sharanya R', slug: 'sharanya-r' },
  { employeeNumber: 'DBYA0027', name: 'Sheeja', slug: 'sheeja' },
  { employeeNumber: 'DBYA0015', name: 'Srinivas G', slug: 'srinivas-g' },
  { employeeNumber: 'DBYA0011', name: 'Swetha N', slug: 'swetha-n' },
  { employeeNumber: 'DBYA0021', name: 'Yasar Arafat', slug: 'yasar-arafat' },
  { employeeNumber: 'DBYA0009', name: 'Sandhya', slug: 'sandhya' },
  // Junior Sales Executives and Sales Assistants (and Anitha, Senior Sales Executive) from HR's Keka employee master, 20 Nov 2026.
  { employeeNumber: 'DBYA0041', name: 'Nisar Ahmed', slug: 'nisar-ahmed' },
  { employeeNumber: 'DBYA0042', name: 'Yuvaraj S', slug: 'yuvaraj-s' },
  { employeeNumber: 'DBYA0043', name: 'Venugopal S', slug: 'venugopal-s' },
  { employeeNumber: 'DBYA0044', name: 'Annapurna N', slug: 'annapurna-n' },
  { employeeNumber: 'DBYA0046', name: 'Vijay Kumar', slug: 'vijay-kumar' },
  { employeeNumber: 'DBYA0047', name: 'Ajith Kumar', slug: 'ajith-kumar' },
  { employeeNumber: 'DBYA0048', name: 'Anitha', slug: 'anitha' },
  { employeeNumber: 'DBYA0050', name: 'Pavithra K', slug: 'pavithra-k' },
  { employeeNumber: 'DBYA0051', name: 'Thangaivelu D', slug: 'thangaivelu-d' },
  { employeeNumber: 'DBYA0052', name: 'Rakesh Kumar', slug: 'rakesh-kumar' },
  { employeeNumber: 'DBYA0053', name: 'Rajeev Kumar', slug: 'rajeev-kumar' },
  { employeeNumber: 'DBYA0054', name: 'Vinayaka Savanur', slug: 'vinayaka-savanur' },
  { employeeNumber: 'DBYA0061', name: 'Madfuz MD', slug: 'madfuz-md' },
  { employeeNumber: 'DBYA0062', name: 'Shahzad M D', slug: 'shahzad-m-d' },
  { employeeNumber: 'DBYA0063', name: 'Raj Kumar', slug: 'raj-kumar' },
  { employeeNumber: 'DBYA0064', name: 'Rohith', slug: 'rohith' },
  { employeeNumber: 'DBYA0066', name: 'Manjesh Kumar', slug: 'manjesh-kumar' },
  { employeeNumber: 'DBYA0067', name: 'Vikash Kumar', slug: 'vikash-kumar' },
  { employeeNumber: 'DBYA0068', name: 'Komal R', slug: 'komal-r' },
  // Shared desk for the Chennai campaign leads (see SHEET_ROUTES).
  { employeeNumber: 'DBYACHENNAI', name: 'Chennai', slug: 'chennai', password: 'chennai' },
] as const satisfies readonly Salesperson[];

export function getSalesperson(slug: string) {
  return SALESPEOPLE.find((salesperson) => salesperson.slug === slug);
}

export function getSalespersonByEmployeeNumber(employeeNumber: string) {
  const normalized = employeeNumber.trim().toUpperCase();
  return SALESPEOPLE.find((salesperson) => salesperson.employeeNumber === normalized);
}

export function isSalespersonLogin(salesperson: Salesperson, employeeNumber: string, password: string) {
  const expectedPassword = salesperson.password ?? `Ananta${salesperson.employeeNumber.slice(-4)}`;
  return employeeNumber.trim().toUpperCase() === salesperson.employeeNumber && password === expectedPassword;
}

export function authenticateSalesperson(employeeNumber: string, password: string) {
  const salesperson = getSalespersonByEmployeeNumber(employeeNumber);
  return salesperson && isSalespersonLogin(salesperson, employeeNumber, password) ? salesperson : undefined;
}
