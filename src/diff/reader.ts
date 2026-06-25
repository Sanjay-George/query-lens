export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** Lines in the hunk including ' ', '+', '-' prefixes (header line stripped). */
  lines: string[];
  /** Just the '+' and ' ' lines, the post-change view of the hunk. */
  addedLines: AddedLine[];
}

export interface AddedLine {
  /** 1-indexed line number in the new file. */
  lineNumber: number;
  /** Raw line content without the leading '+'. */
  text: string;
}

export interface DiffFile {
  oldPath: string | null;
  newPath: string | null;
  hunks: DiffHunk[];
}

const FILE_HEADER = /^diff --git a\/(.+) b\/(.+)$/;
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Parse a unified diff (as produced by `git diff` or the GitHub diff API)
 * into a list of files with their hunks. Binary diffs and rename-only diffs
 * are returned with an empty `hunks` array.
 */
export function parseUnifiedDiff(input: string): DiffFile[] {
  const lines = input.split('\n');
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let currentHunk: DiffHunk | null = null;
  let newLineCursor = 0;

  for (const line of lines) {
    const fileMatch = FILE_HEADER.exec(line);
    if (fileMatch) {
      if (current) files.push(current);
      current = { oldPath: fileMatch[1] ?? null, newPath: fileMatch[2] ?? null, hunks: [] };
      currentHunk = null;
      continue;
    }
    if (!current) continue;

    // /dev/null markers indicate add/delete; capture them so callers can tell.
    if (line.startsWith('--- ')) {
      const p = line.slice(4).trim();
      current.oldPath = p === '/dev/null' ? null : stripPathPrefix(p);
      continue;
    }
    if (line.startsWith('+++ ')) {
      const p = line.slice(4).trim();
      current.newPath = p === '/dev/null' ? null : stripPathPrefix(p);
      continue;
    }

    const hunkMatch = HUNK_HEADER.exec(line);
    if (hunkMatch) {
      const oldStart = Number(hunkMatch[1]);
      const oldLines = hunkMatch[2] ? Number(hunkMatch[2]) : 1;
      const newStart = Number(hunkMatch[3]);
      const newLines = hunkMatch[4] ? Number(hunkMatch[4]) : 1;
      currentHunk = {
        oldStart,
        oldLines,
        newStart,
        newLines,
        lines: [],
        addedLines: [],
      };
      current.hunks.push(currentHunk);
      newLineCursor = newStart;
      continue;
    }

    if (!currentHunk) continue;
    if (line.startsWith('\\')) {
      // "\ No newline at end of file" — ignore.
      continue;
    }

    currentHunk.lines.push(line);
    const prefix = line.charAt(0);
    if (prefix === '+') {
      currentHunk.addedLines.push({ lineNumber: newLineCursor, text: line.slice(1) });
      newLineCursor += 1;
    } else if (prefix === ' ') {
      newLineCursor += 1;
    }
    // '-' lines do not advance the new-file cursor.
  }

  if (current) files.push(current);
  return files;
}

function stripPathPrefix(p: string): string {
  // strip the 'a/' or 'b/' git prefix if present
  if (p.startsWith('a/') || p.startsWith('b/')) return p.slice(2);
  return p;
}

/**
 * Get the contiguous line ranges (in the new file) that were added or
 * modified in this file's diff. Useful for anchoring extractor output back
 * to the diff and for asking tree-sitter to expand context around them.
 */
export function changedLineRanges(file: DiffFile): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  for (const hunk of file.hunks) {
    let runStart: number | null = null;
    let lastLine: number | null = null;
    for (const added of hunk.addedLines) {
      if (runStart === null) {
        runStart = added.lineNumber;
        lastLine = added.lineNumber;
        continue;
      }
      if (lastLine !== null && added.lineNumber === lastLine + 1) {
        lastLine = added.lineNumber;
      } else {
        ranges.push({ start: runStart, end: lastLine! });
        runStart = added.lineNumber;
        lastLine = added.lineNumber;
      }
    }
    if (runStart !== null && lastLine !== null) {
      ranges.push({ start: runStart, end: lastLine });
    }
  }
  return ranges;
}
