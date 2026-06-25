import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff, changedLineRanges } from '../src/diff/reader.js';

const SAMPLE = `diff --git a/src/users.ts b/src/users.ts
index 1111111..2222222 100644
--- a/src/users.ts
+++ b/src/users.ts
@@ -10,4 +10,7 @@ export async function getUser(id: number) {
   return await db.query(
     'SELECT * FROM users WHERE id = $1',
     [id],
   );
+  // new comment
+  // another new comment
+  const x = 1;
 }
diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+export const foo = 1;
+export const bar = 2;
`;

describe('parseUnifiedDiff', () => {
  it('parses two files with their hunks', () => {
    const files = parseUnifiedDiff(SAMPLE);
    expect(files).toHaveLength(2);
    expect(files[0]!.newPath).toBe('src/users.ts');
    expect(files[0]!.hunks).toHaveLength(1);
    const hunk = files[0]!.hunks[0]!;
    expect(hunk.newStart).toBe(10);
    expect(hunk.newLines).toBe(7);
    expect(hunk.addedLines.map((a) => a.lineNumber)).toEqual([14, 15, 16]);
  });

  it('handles /dev/null for added files', () => {
    const files = parseUnifiedDiff(SAMPLE);
    expect(files[1]!.oldPath).toBeNull();
    expect(files[1]!.newPath).toBe('src/new.ts');
    expect(files[1]!.hunks[0]!.addedLines).toHaveLength(2);
  });
});

describe('changedLineRanges', () => {
  it('collapses contiguous added lines into a range', () => {
    const files = parseUnifiedDiff(SAMPLE);
    const ranges = changedLineRanges(files[0]!);
    expect(ranges).toEqual([{ start: 14, end: 16 }]);
  });

  it('returns multiple ranges when added lines are not contiguous', () => {
    const diff = `diff --git a/x b/x
--- a/x
+++ b/x
@@ -1,6 +1,8 @@
 a
+b
 c
 d
+e
+f
 g
`;
    const files = parseUnifiedDiff(diff);
    expect(changedLineRanges(files[0]!)).toEqual([
      { start: 2, end: 2 },
      { start: 5, end: 6 },
    ]);
  });
});
