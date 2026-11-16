/**
 * Escape a value for use inside single quotes in a Google Drive `q` search.
 * Drive treats backslash and single quote as special inside quoted values.
 * Normal location names (no quotes) come out unchanged.
 */
export function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
