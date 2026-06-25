import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import type ParserType from 'web-tree-sitter';

// web-tree-sitter v0.22 is a CJS Emscripten module whose default export resolves
// inconsistently across Node ESM and Vitest's Vite-based transformer. Loading
// it via createRequire is the only form that yields the same Parser constructor
// in both environments.
const _require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const Parser: typeof ParserType = _require('web-tree-sitter');

type Language = ParserType.Language;
type SyntaxNode = ParserType.SyntaxNode;

export type SupportedLanguage = 'typescript' | 'tsx' | 'python' | 'php';

export interface CodeContext {
  language: SupportedLanguage;
  /** Source of the enclosing function/method, if one wraps the line range. */
  enclosingFunction: {
    startLine: number;
    endLine: number;
    source: string;
  } | null;
  /** Top-level import / use statements as raw source lines. */
  imports: string[];
}

interface LangSpec {
  wasmName: string;
  functionKinds: ReadonlySet<string>;
  importKinds: ReadonlySet<string>;
}

const LANG_SPECS: Record<SupportedLanguage, LangSpec> = {
  typescript: {
    wasmName: 'tree-sitter-typescript.wasm',
    functionKinds: new Set([
      'function_declaration',
      'method_definition',
      'arrow_function',
      'function_expression',
      'generator_function_declaration',
    ]),
    importKinds: new Set(['import_statement']),
  },
  tsx: {
    wasmName: 'tree-sitter-tsx.wasm',
    functionKinds: new Set([
      'function_declaration',
      'method_definition',
      'arrow_function',
      'function_expression',
      'generator_function_declaration',
    ]),
    importKinds: new Set(['import_statement']),
  },
  python: {
    wasmName: 'tree-sitter-python.wasm',
    functionKinds: new Set(['function_definition']),
    importKinds: new Set(['import_statement', 'import_from_statement']),
  },
  php: {
    wasmName: 'tree-sitter-php.wasm',
    functionKinds: new Set(['function_definition', 'method_declaration']),
    importKinds: new Set(['namespace_use_declaration']),
  },
};

export function languageForFile(path: string): SupportedLanguage | null {
  const lower = path.toLowerCase();
  if (lower.endsWith('.ts') || lower.endsWith('.mts') || lower.endsWith('.cts')) return 'typescript';
  if (lower.endsWith('.tsx')) return 'tsx';
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return 'typescript';
  if (lower.endsWith('.jsx')) return 'tsx';
  if (lower.endsWith('.py')) return 'python';
  if (lower.endsWith('.php')) return 'php';
  return null;
}

export class ContextResolver {
  private readonly languages = new Map<SupportedLanguage, Language>();
  private initialized = false;

  private constructor() {}

  static async create(): Promise<ContextResolver> {
    const r = new ContextResolver();
    await r.init();
    return r;
  }

  private async init(): Promise<void> {
    if (this.initialized) return;
    await Parser.init();
    this.initialized = true;
  }

  private async loadLanguage(lang: SupportedLanguage): Promise<Language> {
    const cached = this.languages.get(lang);
    if (cached) return cached;
    const wasmPath = _require.resolve(`tree-sitter-wasms/out/${LANG_SPECS[lang].wasmName}`);
    const bytes = await readFile(wasmPath);
    const language = await Parser.Language.load(new Uint8Array(bytes));
    this.languages.set(lang, language);
    return language;
  }

  async resolve(
    language: SupportedLanguage,
    source: string,
    range: { startLine: number; endLine: number },
  ): Promise<CodeContext> {
    const lang = await this.loadLanguage(language);
    const parser = new Parser();
    parser.setLanguage(lang);
    const tree = parser.parse(source);
    if (!tree) {
      return { language, enclosingFunction: null, imports: [] };
    }
    const spec = LANG_SPECS[language];

    const sourceLines = source.split('\n');

    // Find the deepest function-like node that fully contains the range.
    const targetStartRow = range.startLine - 1;
    const targetEndRow = range.endLine - 1;
    let enclosing: { startRow: number; endRow: number } | null = null;

    const visit = (node: SyntaxNode): void => {
      const nodeStart = node.startPosition.row;
      const nodeEnd = node.endPosition.row;
      if (nodeStart > targetEndRow || nodeEnd < targetStartRow) return;
      if (spec.functionKinds.has(node.type)
          && nodeStart <= targetStartRow
          && nodeEnd >= targetEndRow) {
        enclosing = { startRow: nodeStart, endRow: nodeEnd };
      }
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) visit(child);
      }
    };
    visit(tree.rootNode);

    const enclosingFn = enclosing
      ? extractRange(sourceLines, (enclosing as { startRow: number; endRow: number }).startRow, (enclosing as { startRow: number; endRow: number }).endRow)
      : null;

    const imports: string[] = [];
    for (let i = 0; i < tree.rootNode.childCount; i++) {
      const node = tree.rootNode.child(i);
      if (!node) continue;
      if (spec.importKinds.has(node.type)) {
        imports.push(node.text);
      }
    }
    // PHP wraps everything in a `program > <?php ... ?>` structure; descend one level for it.
    if (language === 'php' && imports.length === 0) {
      const walk = (n: SyntaxNode, depth: number): void => {
        if (depth > 3) return;
        if (spec.importKinds.has(n.type)) imports.push(n.text);
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i);
          if (c) walk(c, depth + 1);
        }
      };
      walk(tree.rootNode, 0);
    }

    tree.delete();
    parser.delete();

    return {
      language,
      enclosingFunction: enclosingFn,
      imports,
    };
  }
}

function extractRange(
  sourceLines: string[],
  startRow: number,
  endRow: number,
): { startLine: number; endLine: number; source: string } {
  const slice = sourceLines.slice(startRow, endRow + 1).join('\n');
  return { startLine: startRow + 1, endLine: endRow + 1, source: slice };
}
