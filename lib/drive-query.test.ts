import { describe, expect, it } from 'vitest';
import { escapeDriveQueryValue } from './drive-query';

describe('escapeDriveQueryValue', () => {
  it('leaves normal file names unchanged', () => {
    expect(escapeDriveQueryValue('warehouse-draft-la-office.json')).toBe('warehouse-draft-la-office.json');
  });

  it('escapes quotes and backslashes so input cannot widen a search', () => {
    expect(escapeDriveQueryValue("x' or name contains '")).toBe("x\\' or name contains \\'");
    expect(escapeDriveQueryValue('a\\b')).toBe('a\\\\b');
  });
});
