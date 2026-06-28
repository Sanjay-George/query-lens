import { describe, it, expect } from 'vitest';
import { parseUnifiedDiff } from '../src/diff/reader.js';
import { buildUserPrompt, SYSTEM_PROMPT } from '../src/baseline/prompt.js';

const DIFF = `diff --git a/app/users.ts b/app/users.ts
--- a/app/users.ts
+++ b/app/users.ts
@@ -10,3 +10,5 @@
 export function getActive() {
-  return db.query('SELECT id FROM users');
+  return db.query('SELECT * FROM users WHERE email LIKE \\'%@gmail.com\\'');
+  // unbounded scan
+  // no LIMIT
 }
`;

describe('baseline prompt', () => {
  it('annotates added/context lines with new-file line numbers', () => {
    const [file] = parseUnifiedDiff(DIFF);
    const prompt = buildUserPrompt(file!);

    expect(prompt).toContain('app/users.ts');
    expect(prompt).toContain('Language hint: .ts');
    // Hunk starts at new line 10, so the context line ` export function getActive()` is L10.
    expect(prompt).toMatch(/10  export function getActive/);
    // The added SELECT * line is at L11 (line 10 was kept, then a '-' deletion that
    // doesn't advance the new cursor, then the first '+' is L11).
    expect(prompt).toMatch(/11 \+\s*return db\.query\('SELECT \*/);
    // '-' lines should appear without a line number (just the marker).
    expect(prompt).toContain('. -  return db.query(\'SELECT id');
  });

  it('system prompt names the role and lists at least one concrete pattern', () => {
    expect(SYSTEM_PROMPT).toMatch(/senior database engineer/i);
    expect(SYSTEM_PROMPT).toMatch(/index/i);
    expect(SYSTEM_PROMPT).toMatch(/LIMIT/);
  });
});
