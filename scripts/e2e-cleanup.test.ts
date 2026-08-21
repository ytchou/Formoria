import { describe, expect, it } from 'vitest';
import {
  paginateDatabaseRows,
  paginateStorageList,
} from '../e2e/helpers/cleanup';

function storagePage(prefix: string, length: number) {
  return Array.from({ length }, (_, index) => ({
    name: `${prefix}-${index}`,
    id: `${prefix}-${index}`,
  }));
}

function databasePage(prefix: string, length: number) {
  return Array.from({ length }, (_, index) => ({
    id: `${prefix}-${index}`,
  }));
}

describe('E2E cleanup pagination', () => {
  it('discovers storage objects beyond the PostgREST-sized first page', async () => {
    const calls: Array<[number, number]> = [];
    const entries = await paginateStorageList(async (offset, limit) => {
      calls.push([offset, limit]);
      return offset === 0
        ? { data: storagePage('first', limit), error: null }
        : { data: storagePage('last', 1), error: null };
    });

    expect(entries).toHaveLength(1_001);
    expect(calls).toEqual([[0, 1_000], [1_000, 1_000]]);
  });

  it('discovers database rows beyond the PostgREST-sized first page', async () => {
    const calls: Array<[number, number]> = [];
    const rows = await paginateDatabaseRows(async (offset, limit) => {
      calls.push([offset, limit]);
      return offset === 0
        ? { data: databasePage('first', limit), error: null }
        : { data: databasePage('last', 1), error: null };
    });

    expect(rows).toHaveLength(1_001);
    expect(calls).toEqual([[0, 1_000], [1_000, 1_000]]);
  });

  it('rejects a repeated storage page', async () => {
    const page = storagePage('same', 1_000);
    await expect(paginateStorageList(async () => ({ data: page, error: null }))).rejects.toThrow(/repeated/);
  });

  it('rejects a repeated database page', async () => {
    const page = databasePage('same', 1_000);
    await expect(paginateDatabaseRows(async () => ({ data: page, error: null }))).rejects.toThrow(/repeated/);
  });

  it('rejects malformed storage page data', async () => {
    await expect(paginateStorageList(async () => ({ data: null, error: null }))).rejects.toThrow(/malformed/);
  });

  it('rejects malformed database page data', async () => {
    await expect(paginateDatabaseRows(async () => ({ data: null, error: null }))).rejects.toThrow(/malformed/);
  });

  it('surfaces storage provider page errors', async () => {
    await expect(paginateStorageList(async () => ({ data: null, error: { message: 'storage unavailable' } }))).rejects.toThrow('storage unavailable');
  });

  it('surfaces database provider page errors', async () => {
    await expect(paginateDatabaseRows(async () => ({ data: null, error: { message: 'database unavailable' } }))).rejects.toThrow('database unavailable');
  });

  it('rejects a database page that does not advance its range', async () => {
    await expect(paginateDatabaseRows(async (_offset, limit) => ({
      data: databasePage('stuck', limit),
      error: null,
      nextOffset: 0,
    }))).rejects.toThrow(/did not advance/);
  });

  it('rejects a storage page that does not advance its offset', async () => {
    await expect(paginateStorageList(async (_offset, limit) => ({
      data: storagePage('stuck', limit),
      error: null,
      nextOffset: 0,
    }))).rejects.toThrow(/did not advance/);
  });

  it('rejects a storage pagination run that exceeds its bound', async () => {
    let page = 0;
    await expect(paginateStorageList(
      async (_offset, limit) => ({ data: storagePage(`page-${page++}`, limit), error: null }),
      { maxPages: 2 },
    )).rejects.toThrow(/exceeded 2 pages/);
  });

  it('rejects a database pagination run that exceeds its bound', async () => {
    let page = 0;
    await expect(paginateDatabaseRows(
      async (_offset, limit) => ({ data: databasePage(`page-${page++}`, limit), error: null }),
      { maxPages: 2 },
    )).rejects.toThrow(/exceeded 2 pages/);
  });
});
