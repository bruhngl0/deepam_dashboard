/**
 * CSV encoding — RFC 4180, the parts that matter for this data: a field is
 * quoted whenever it contains a comma, a quote, or a newline, and an embedded
 * quote is escaped by doubling it. Names and free-text fields (area, city,
 * campaign names) can contain any of the three, so this cannot be skipped.
 */

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(escapeCell).join(',')];
  for (const row of rows) lines.push(row.map(escapeCell).join(','));
  // CRLF per RFC 4180 — Excel on Windows, still the likeliest opener here,
  // treats a bare LF as one long row rather than one row per line.
  return lines.join('\r\n');
}
