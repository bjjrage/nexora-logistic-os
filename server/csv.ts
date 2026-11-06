/** Quote every cell and neutralize spreadsheet formulas, including hidden prefixes. */
export function encodeCsv(rows: readonly (readonly unknown[])[]): string {
  const quote = (value: unknown) => {
    const raw = String(value ?? '');
    const unsafePrefix = /^[\u0000-\u001f\u007f\ufeff]/.test(raw) || /^[\s\u0000-\u001f\u007f\ufeff]*[=+\-@]/.test(raw);
    const text = typeof value === 'string' && unsafePrefix ? `'${raw}` : raw;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return rows.map(row => row.map(quote).join(',')).join('\r\n') + '\r\n';
}
