import { describe, it, expect } from 'vitest';
import { flattenSidebarTree } from '../sidebarTree';
import type { ColumnInfo, TableInfo, TableStructure } from '@/lib/types';

const t = (name: string, over: Partial<TableInfo> = {}): TableInfo => ({
  name,
  table_type: 'Table',
  row_count_estimate: null,
  size_bytes: null,
  comment: null,
  ...over,
});

const col = (name: string, over: Partial<ColumnInfo> = {}): ColumnInfo => ({
  name,
  data_type: 'text',
  mapped_type: 'text',
  nullable: true,
  default_value: null,
  is_primary_key: false,
  ordinal_position: 1,
  comment: null,
  ...over,
});

const structure = (cols: (string | ColumnInfo)[], over: Partial<TableStructure> = {}): TableStructure =>
  ({
    columns: cols.map((c, i) =>
      typeof c === 'string' ? col(c, { ordinal_position: i + 1 }) : c,
    ),
    foreign_keys: [],
    ...over,
  }) as TableStructure;

describe('flattenSidebarTree', () => {
  it('nested mode lists dbs, expands only expanded dbs', () => {
    const nodes = flattenSidebarTree({
      mode: 'nested',
      databases: ['a', 'b'],
      tablesByDb: { a: [t('t1'), t('t2')], b: [t('t3')] },
      expandedDbs: new Set(['a']),
      expandedTables: new Set(),
      structures: {},
      structureLoading: {},
    });
    expect(nodes.map((n) => n.key)).toEqual(['a', 'a.t1', 'a.t2', 'b']);
    expect(nodes[0]).toMatchObject({ kind: 'db', expanded: true, tableCount: 2 });
  });

  it('expanded table with a loaded structure emits its column rows', () => {
    const nodes = flattenSidebarTree({
      mode: 'flat',
      databases: ['a'],
      tablesByDb: { a: [t('t1')] },
      expandedDbs: new Set(),
      expandedTables: new Set(['a.t1']),
      structures: { 'a.t1': structure(['id', 'name']) },
      structureLoading: {},
    });
    expect(nodes.map((n) => n.kind)).toEqual(['table', 'column', 'column']);
    expect(nodes[1]).toMatchObject({ kind: 'column', name: 'id', table: 't1' });
  });

  it('expanded table still loading emits the table row flagged loading, no columns', () => {
    const nodes = flattenSidebarTree({
      mode: 'flat',
      databases: ['a'],
      tablesByDb: { a: [t('t1')] },
      expandedDbs: new Set(),
      expandedTables: new Set(['a.t1']),
      structures: {},
      structureLoading: { 'a.t1': true },
    });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ kind: 'table', expanded: true, loading: true });
  });

  it('autoExpandTables expands without touching expandedTables (search behavior)', () => {
    const nodes = flattenSidebarTree({
      mode: 'flat',
      databases: ['a'],
      tablesByDb: { a: [t('t1')] },
      expandedDbs: new Set(),
      expandedTables: new Set(),
      structures: { 'a.t1': structure(['id']) },
      structureLoading: {},
      autoExpandTables: new Set(['a.t1']),
    });
    expect(nodes.map((n) => n.kind)).toEqual(['table', 'column']);
  });

  it('flat mode emits no db rows and only the given database', () => {
    const nodes = flattenSidebarTree({
      mode: 'flat',
      databases: ['a'],
      tablesByDb: { a: [t('t1'), t('t2')] },
      expandedDbs: new Set(),
      expandedTables: new Set(),
      structures: {},
      structureLoading: {},
    });
    expect(nodes.every((n) => n.kind === 'table')).toBe(true);
  });

  it('carries the facts the rows render: pk/fk markers, formatted type, nullability', () => {
    const nodes = flattenSidebarTree({
      mode: 'flat',
      databases: ['a'],
      tablesByDb: { a: [t('t1')] },
      expandedDbs: new Set(),
      expandedTables: new Set(['a.t1']),
      structures: {
        'a.t1': structure(
          [
            col('id', { is_primary_key: true, nullable: false, ordinal_position: 1 }),
            col('owner_id', { data_type: { Varchar: 255 } as unknown as string, ordinal_position: 2 }),
          ],
          {
            foreign_keys: [
              {
                name: 'fk_owner',
                columns: ['owner_id'],
                referenced_table: { database: 'a', schema: null, table: 'owners' },
                referenced_columns: ['id'],
                on_update: 'NO ACTION',
                on_delete: 'NO ACTION',
              },
            ],
          },
        ),
      },
      structureLoading: {},
    });
    expect(nodes[1]).toMatchObject({
      kind: 'column',
      name: 'id',
      dataType: 'text',
      nullable: false,
      isPk: true,
      isFk: false,
      ordinalPosition: 1,
    });
    expect(nodes[2]).toMatchObject({ name: 'owner_id', dataType: 'varchar(255)', isPk: false, isFk: true });
  });

  it('a collapsed table emits no columns even with a loaded structure', () => {
    const nodes = flattenSidebarTree({
      mode: 'nested',
      databases: ['a'],
      tablesByDb: { a: [t('t1')] },
      expandedDbs: new Set(['a']),
      expandedTables: new Set(),
      structures: { 'a.t1': structure(['id']) },
      structureLoading: {},
    });
    expect(nodes.map((n) => n.kind)).toEqual(['db', 'table']);
  });

  it('nested rows are one level deeper than flat rows', () => {
    const args = {
      databases: ['a'],
      tablesByDb: { a: [t('t1')] },
      expandedDbs: new Set(['a']),
      expandedTables: new Set(['a.t1']),
      structures: { 'a.t1': structure(['id']) },
      structureLoading: {},
    };
    const flat = flattenSidebarTree({ mode: 'flat', ...args });
    const nested = flattenSidebarTree({ mode: 'nested', ...args });
    expect(flat.map((n) => n.depth)).toEqual([0, 1]);
    expect(nested.map((n) => n.depth)).toEqual([0, 1, 2]);
  });
});
