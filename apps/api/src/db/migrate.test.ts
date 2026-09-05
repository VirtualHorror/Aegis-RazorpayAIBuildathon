import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MigrationError, checksumOf, downFileFor, listMigrations } from './migrate';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aegis-migrations-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('listMigrations', () => {
  it('returns an empty list for a missing directory', () => {
    expect(listMigrations(join(dir, 'nope'))).toEqual([]);
  });
  it('orders by version and ignores .down.sql files', () => {
    writeFileSync(join(dir, '0002_second.sql'), 'select 2;');
    writeFileSync(join(dir, '0001_first.sql'), 'select 1;');
    writeFileSync(join(dir, '0001_first.down.sql'), 'select -1;');
    const list = listMigrations(dir);
    expect(list.map((m) => `${m.version}_${m.name}`)).toEqual(['0001_first', '0002_second']);
    expect(list[0]?.checksum).toBe(checksumOf('select 1;'));
    expect(downFileFor(list[0]!)).toBe(join(dir, '0001_first.down.sql'));
    expect(downFileFor(list[1]!)).toBeNull();
  });
  it('rejects malformed names and duplicate versions', () => {
    writeFileSync(join(dir, 'init.sql'), 'select 1;');
    expect(() => listMigrations(dir)).toThrow(MigrationError);
    rmSync(join(dir, 'init.sql'));
    writeFileSync(join(dir, '0001_a.sql'), 'select 1;');
    writeFileSync(join(dir, '0001_b.sql'), 'select 1;');
    expect(() => listMigrations(dir)).toThrow(/duplicate migration version 0001/);
  });
});
