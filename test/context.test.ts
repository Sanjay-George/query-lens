import { describe, expect, it, beforeAll } from 'vitest';
import { ContextResolver, languageForFile } from '../src/diff/context.js';

let resolver: ContextResolver;
beforeAll(async () => {
  resolver = await ContextResolver.create();
});

describe('languageForFile', () => {
  it('maps extensions to languages', () => {
    expect(languageForFile('src/x.ts')).toBe('typescript');
    expect(languageForFile('src/x.tsx')).toBe('tsx');
    expect(languageForFile('app/models.py')).toBe('python');
    expect(languageForFile('App/User.php')).toBe('php');
    expect(languageForFile('README.md')).toBeNull();
  });
});

describe('ContextResolver', () => {
  it('finds the enclosing TypeScript function', async () => {
    const source = `import { db } from './db';

export async function getUser(id: number) {
  const rows = await db.query(
    'SELECT * FROM users WHERE id = $1',
    [id],
  );
  return rows[0];
}

export function unrelated() {
  return 42;
}
`;
    const ctx = await resolver.resolve('typescript', source, { startLine: 5, endLine: 5 });
    expect(ctx.enclosingFunction).not.toBeNull();
    expect(ctx.enclosingFunction!.source).toContain('getUser');
    expect(ctx.enclosingFunction!.source).not.toContain('unrelated');
    expect(ctx.imports).toEqual(["import { db } from './db';"]);
  });

  it('finds the enclosing Python function', async () => {
    const source = `from app.db import session

def get_user(uid):
    return session.execute(
        "SELECT * FROM users WHERE id = :id",
        {"id": uid},
    ).first()
`;
    const ctx = await resolver.resolve('python', source, { startLine: 5, endLine: 5 });
    expect(ctx.enclosingFunction).not.toBeNull();
    expect(ctx.enclosingFunction!.source).toContain('def get_user');
    expect(ctx.imports.length).toBeGreaterThan(0);
  });

  it('finds the enclosing PHP method and collects use statements', async () => {
    const source = `<?php

namespace App\\Http\\Controllers;

use App\\Models\\User;
use Illuminate\\Support\\Facades\\DB;

class UserController
{
    public function show($id)
    {
        return User::where('id', $id)->first();
    }
}
`;
    const ctx = await resolver.resolve('php', source, { startLine: 12, endLine: 12 });
    expect(ctx.enclosingFunction).not.toBeNull();
    expect(ctx.enclosingFunction!.source).toContain('function show');
    expect(ctx.imports.some((i) => i.includes('App\\Models\\User'))).toBe(true);
  });

  it('returns null enclosingFunction for top-level code', async () => {
    const source = `const x = 1;\nconst y = 2;\n`;
    const ctx = await resolver.resolve('typescript', source, { startLine: 1, endLine: 1 });
    expect(ctx.enclosingFunction).toBeNull();
  });
});
