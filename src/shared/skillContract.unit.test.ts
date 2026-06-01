import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256Hex, anchorText } from './hash';
import {
  parseGroup,
  serializeGroup,
  parseCommentFile,
  serializeCommentFile,
  type AnnotationGroup,
  type CommentFile,
} from './model';
import { slugifyAuthor } from '../core/comments';

const CONTRACT_DOC = 'skills/annotated-agent/references/data-contract.md';

// Canonical node-free content-hash recipe. The doc MUST embed this verbatim, and it MUST hash
// identically to sha256Hex(anchorText(...)). $FILE/$START/$END are env vars.
const RECIPE = `awk -v s="$START" -v e="$END" 'NR>=s && NR<=e { printf "%s%s", sep, $0; sep="\\n" }' "$FILE" \\
  | { command -v sha256sum >/dev/null 2>&1 && sha256sum || shasum -a 256; } \\
  | cut -d' ' -f1`;

// Canonical node-free author-slug recipe. The doc MUST embed this verbatim, and it MUST match
// slugifyAuthor for every name. $NAME is an env var.
const SLUG_RECIPE = `s=$(printf '%s' "$NAME" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')
[ -n "$s" ] || s=anon
printf '%s\\n' "$s"`;

function slugViaRecipe(name: string): string {
  return execSync(SLUG_RECIPE, { env: { ...process.env, NAME: name } }).toString().trim();
}

function recipeHash(text: string, start: number, end: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'anno-contract-'));
  const file = join(dir, 'f.txt');
  writeFileSync(file, text);
  try {
    return execSync(RECIPE, {
      env: { ...process.env, FILE: file, START: String(start), END: String(end) },
    })
      .toString()
      .trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const SAMPLES: Array<{ name: string; text: string; start: number; end: number }> = [
  { name: 'single line', text: 'alpha\nbravo\ncharlie', start: 2, end: 2 },
  { name: 'multi line', text: 'alpha\nbravo\ncharlie', start: 1, end: 3 },
  { name: 'blank line inside range', text: 'a\n\nc', start: 1, end: 3 },
  { name: 'no trailing newline', text: 'x\ny', start: 1, end: 2 },
  { name: 'trailing newline file', text: 'm\nn\n', start: 1, end: 2 },
  { name: 'past EOF endLine', text: 'p\nq', start: 1, end: 9 },
];

describe('annotated-agent contract: hash recipe parity', () => {
  for (const s of SAMPLES) {
    it(`recipe matches sha256Hex(anchorText) — ${s.name}`, async () => {
      const expected = await sha256Hex(anchorText(s.text, { startLine: s.start, endLine: s.end }));
      expect(recipeHash(s.text, s.start, s.end)).toBe(expected);
    });
  }
});

describe('annotated-agent contract: doc embeds the canonical recipe', () => {
  it('data-contract.md contains the exact RECIPE text', () => {
    const doc = readFileSync(CONTRACT_DOC, 'utf8');
    expect(doc.includes(RECIPE)).toBe(true);
  });
});

describe('annotated-agent contract: schema round-trip', () => {
  it('a documented group round-trips through parseGroup/serializeGroup', () => {
    const group: AnnotationGroup = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      title: 'Login review',
      author: 'Claude',
      tags: [{ name: 'security', color: '#888888' }],
      gitRef: null,
      status: 'open',
      createdAt: 1730000000,
      updatedAt: 1730000000,
      annotations: [
        {
          id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
          file: 'src/auth/login.ts',
          range: { startLine: 42, endLine: 47 },
          content: 'Note body',
          contentHash: 'abc123',
        },
      ],
    };
    expect(parseGroup(JSON.parse(serializeGroup(group)))).toEqual(group);
  });

  it('a documented comment file round-trips through parseCommentFile/serializeCommentFile', () => {
    const file: CommentFile = {
      author: 'Claude',
      email: '',
      comments: [{ id: 'c1', annotationId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', content: 'Reply', timestamp: 1730000050 }],
    };
    expect(parseCommentFile(JSON.parse(serializeCommentFile(file)))).toEqual(file);
  });
});

describe('annotated-agent contract: slug parity', () => {
  it('matches the documented slug rule', () => {
    expect(slugifyAuthor('Claude')).toBe('claude');
    expect(slugifyAuthor('Ana Díaz!')).toBe('ana-d-az');
    expect(slugifyAuthor('')).toBe('anon');
    expect(slugifyAuthor('@@@')).toBe('anon');
  });
});

describe('annotated-agent contract: slug recipe parity + doc embed', () => {
  for (const name of ['Claude', 'Ana Díaz!', 'Bob Smith', '', '@@@']) {
    it(`shell slug recipe matches slugifyAuthor — ${JSON.stringify(name)}`, () => {
      expect(slugViaRecipe(name)).toBe(slugifyAuthor(name));
    });
  }
  it('data-contract.md embeds the exact SLUG_RECIPE', () => {
    const doc = readFileSync(CONTRACT_DOC, 'utf8');
    expect(doc.includes(SLUG_RECIPE)).toBe(true);
  });
});
