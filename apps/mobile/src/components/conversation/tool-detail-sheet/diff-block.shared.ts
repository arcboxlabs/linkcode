export const DIFF_ADDED_HEX = '#28A745';
export const DIFF_REMOVED_HEX = '#D73A49';

export function gutterLine(row: { type: 'add' | 'del' | 'ctx'; text: string }): string {
  const gutter = row.type === 'add' ? '+' : row.type === 'del' ? '−' : ' ';
  return `${gutter} ${row.text || ' '}`;
}
