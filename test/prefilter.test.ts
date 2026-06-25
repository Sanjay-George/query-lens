import { describe, expect, it } from 'vitest';
import { hasQueryShape } from '../src/extract/prefilter.js';

describe('hasQueryShape', () => {
  it.each([
    'const sql = "SELECT * FROM users"',
    'INSERT INTO orders (id) VALUES (1)',
    'update users set name = $1',
    'delete from sessions where expired',
    'WITH recent AS (SELECT 1) SELECT * FROM recent',
    'await db.query(sql)',
    'conn.execute("...")',
    'knex.raw(`...`)',
    '$pdo->prepare($q)',
    'DB::select($q)',
  ])('flags query-shaped text: %s', (text) => {
    expect(hasQueryShape(text)).toBe(true);
  });

  it.each([
    'const total = a + b;',
    'return res.status(200).json(data);',
    'function deleteButton() {}', // "delete" without "from" is not a verb match
    'this.selectall = true;', // no call paren adjacency
    '',
  ])('does not flag non-query text: %s', (text) => {
    expect(hasQueryShape(text)).toBe(false);
  });
});
