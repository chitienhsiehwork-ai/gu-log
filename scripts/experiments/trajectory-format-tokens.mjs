#!/usr/bin/env node
/**
 * trajectory-format-tokens — JSON vs YAML vs pseudo-YAML token 實測
 *
 * 這支是 GP 文章裡 Mogu 那段實測數字的來源，留在 repo 讓數字可重跑、可驗證
 * （gu-log 的 provenance 規矩：文章引用的實驗要能被讀者自己跑一次）。
 *
 * 背景：Letta 的 trajectory 套件把各家 coding agent 的 session 正規化成一種
 * 「給 agent 讀」的格式，賣點是 token 效率，而格式本身是純 JSON。問題是
 * 「JSON 換成 YAML 會不會更省」的直覺其實是錯的——省下來的不是引號跟大括號，
 * 是整層 schema envelope（`"role":`、`"tool_call_id":`、完整 ISO timestamp）
 * 跟長字串的 `\n` 逃逸。這支就是把這件事量出來。
 *
 *   node scripts/experiments/trajectory-format-tokens.mjs
 *
 * Tokenizer 用 gpt-tokenizer（o200k_base）。Claude 的 tokenizer 不同，絕對值
 * 會有出入，但這裡看的是同一份資料在不同排版下的「比例」，結論不受影響。
 *
 * 兩個情境是刻意選的，因為 trajectory 的 default mode 會截斷長 tool result：
 *   A. content-heavy —— 未截斷、tool result 是整段檔案內容
 *   B. envelope-heavy —— 一堆短 tool call + 截斷過的 result（default mode 的常態）
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let encode;
try {
  ({ encode } = await import('gpt-tokenizer'));
} catch {
  console.error(
    'Missing gpt-tokenizer. Install it first:\n  pnpm add -D gpt-tokenizer\n' +
      '(dev-only；只有這支實驗腳本用得到)'
  );
  process.exit(1);
}

const YAML = (await import('yaml')).default;

const readLines = (rel, n) =>
  readFileSync(path.join(REPO_ROOT, rel), 'utf8').split('\n').slice(0, n).join('\n');

/**
 * pseudo-YAML renderer：人看得懂優先，長字串走 block scalar 不做逃逸。
 *
 * ⚠️ 這是單向 render，不是可解析的 YAML。它省 token 靠的正是丟掉合規 YAML
 * 用來保證 round-trip 的東西（`|2-` 縮排指示符、遇到 CRLF 退回引號模式）。
 * 當展示層沒問題，當儲存格式會在 content 含 CRLF / 行尾空白時靜默壞掉。
 */
function renderPseudoYaml(records) {
  const out = [];
  const field = (key, value, indent) => {
    const text = String(value);
    const lines = text.split('\n');
    if (lines.length === 1 && text.length < 80) return `${indent}${key}: ${text}`;
    return `${indent}${key}: |\n${lines.map((l) => `${indent}  ${l}`).join('\n')}`;
  };

  for (const r of records) {
    if (r.role === 'meta') {
      const meta = Object.entries(r)
        .filter(([k]) => k !== 'role' && k !== 'source')
        .map(([k, v]) => `${k}=${v}`)
        .join('  ');
      out.push(`meta: ${r.source}${meta ? `  ${meta}` : ''}`);
      continue;
    }
    const ts = r.timestamp ? r.timestamp.slice(11, 19) : '';
    if (r.role === 'assistant' && r.tool_calls) {
      out.push(`assistant [${ts}]`);
      for (const call of r.tool_calls) {
        out.push(`  call ${call.id} ${call.name}`);
        let args = null;
        try {
          args = JSON.parse(call.args);
        } catch {
          /* args 不是 JSON string 就原樣輸出 */
        }
        if (args && typeof args === 'object') {
          for (const [k, v] of Object.entries(args)) out.push(field(k, v, '    '));
        } else {
          out.push(field('args', call.args, '    '));
        }
      }
      continue;
    }
    if (r.role === 'tool') {
      out.push(`tool_result ${r.tool_call_id} [${ts}]`);
      out.push(field('content', r.content, '  '));
      continue;
    }
    out.push(`${r.role} [${ts}]`);
    out.push(field('content', r.content, '  '));
  }
  return out.join('\n');
}

const variants = (records) => ({
  'JSON (pretty)': JSON.stringify(records, null, 2),
  'JSON (compact)': JSON.stringify(records),
  JSONL: records.map((r) => JSON.stringify(r)).join('\n'),
  'YAML (spec)': YAML.stringify(records, { lineWidth: 0 }),
  'pseudo-YAML': renderPseudoYaml(records),
});

function report(label, records) {
  const rendered = variants(records);
  const tokens = Object.fromEntries(
    Object.entries(rendered).map(([name, text]) => [name, encode(text).length])
  );
  const base = tokens['JSON (pretty)'];
  const jsonl = tokens['JSONL'];

  console.log(`\n## ${label}（${records.length} records）\n`);
  console.log(
    'format'.padEnd(18) + 'tokens'.padStart(8) + 'vs pretty'.padStart(12) + 'vs JSONL'.padStart(11)
  );
  for (const [name, count] of Object.entries(tokens)) {
    const pct = (n) => `${((count / n - 1) * 100).toFixed(1)}%`;
    console.log(
      name.padEnd(18) + String(count).padStart(8) + pct(base).padStart(12) + pct(jsonl).padStart(11)
    );
  }
  return tokens;
}

// ── 情境 A：content-heavy（未截斷，tool result 是真實檔案內容）──────────────
const contentHeavy = [
  {
    role: 'meta',
    source: 'claude-code',
    cwd: '/home/user/gu-log',
    git_branch: 'main',
    model: 'claude-opus-5',
  },
  {
    role: 'user',
    content: '驗證器壞了，幫我看一下 validate-posts.mjs 為什麼 frontmatter 檢查會噴錯',
    timestamp: '2026-07-24T12:00:00.000Z',
  },
  {
    role: 'reasoning',
    content:
      'The user reports validate-posts.mjs failing on frontmatter.\nRead the script first to see what schema it enforces,\nthen check one failing post. Likely a schema mismatch after\nthe recent tribunalVersion bump.',
    timestamp: '2026-07-24T12:00:02.000Z',
  },
  {
    role: 'assistant',
    content: null,
    tool_calls: [
      {
        id: 'call_1',
        name: 'Read',
        args: JSON.stringify({ file_path: 'scripts/validate-posts.mjs', limit: 60 }),
      },
    ],
    timestamp: '2026-07-24T12:00:03.000Z',
  },
  {
    role: 'tool',
    tool_call_id: 'call_1',
    content: readLines('scripts/validate-posts.mjs', 60),
    timestamp: '2026-07-24T12:00:04.000Z',
  },
  {
    role: 'assistant',
    content: null,
    tool_calls: [
      {
        id: 'call_2',
        name: 'Bash',
        args: JSON.stringify({ command: 'node scripts/validate-posts.mjs 2>&1 | tail -20' }),
      },
    ],
    timestamp: '2026-07-24T12:00:05.000Z',
  },
  {
    role: 'tool',
    tool_call_id: 'call_2',
    content:
      '❌ FAILED: 3 files\n  gp-2026-07-20-trajectory.md\n    - tribunalVersion: Expected number, received string\n  mp-2026-07-19-context.md\n    - sourceUrl: Invalid url',
    timestamp: '2026-07-24T12:00:07.000Z',
  },
  {
    role: 'assistant',
    content: null,
    tool_calls: [
      { id: 'call_3', name: 'Read', args: JSON.stringify({ file_path: 'AGENTS.md', limit: 40 }) },
    ],
    timestamp: '2026-07-24T12:00:08.000Z',
  },
  {
    role: 'tool',
    tool_call_id: 'call_3',
    content: readLines('AGENTS.md', 40),
    timestamp: '2026-07-24T12:00:09.000Z',
  },
  {
    role: 'assistant',
    content: '三個都是 frontmatter 型別問題，不是驗證器壞掉。修掉那三篇的欄位就好。',
    timestamp: '2026-07-24T12:00:12.000Z',
  },
];

// ── 情境 B：envelope-heavy（短 tool call + 截斷過的 result）─────────────────
const envelopeHeavy = [
  {
    role: 'meta',
    source: 'claude-code',
    cwd: '/home/user/gu-log',
    git_branch: 'main',
    model: 'claude-opus-5',
  },
];
for (let i = 0; i < 40; i++) {
  const ts = `2026-07-24T12:${String(10 + Math.floor(i / 2)).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}.000Z`;
  const isEdit = i % 2 === 1;
  envelopeHeavy.push({
    role: 'assistant',
    content: null,
    tool_calls: [
      {
        id: `call_${i}`,
        name: isEdit ? 'Edit' : 'Read',
        args: JSON.stringify(
          isEdit
            ? {
                file_path: `src/content/posts/gp-2026-07-${10 + (i % 20)}-post.md`,
                old_string: 'tribunalVersion: 8',
                new_string: 'tribunalVersion: 9',
              }
            : { file_path: `src/content/posts/gp-2026-07-${10 + (i % 20)}-post.md` }
        ),
      },
    ],
    timestamp: ts,
  });
  envelopeHeavy.push({
    role: 'tool',
    tool_call_id: `call_${i}`,
    content: isEdit
      ? 'The file has been updated.'
      : '---\ntitle: 範例文章\ntribunalVersion: 8\n---\n[truncated: 4210 chars]',
    timestamp: ts,
  });
}

console.log('trajectory format token benchmark — tokenizer: gpt-tokenizer (o200k_base)');
report('情境 A：content-heavy（未截斷）', contentHeavy);
report('情境 B：envelope-heavy（default 截斷模式的常態）', envelopeHeavy);

// 純 envelope 成本：把 content 清空，看格式本身佔多少
const stripped = contentHeavy.map((r) => (r.content == null ? r : { ...r, content: '' }));
console.log('\n## envelope only（content 清空後，格式本身的成本）\n');
for (const [name, text] of Object.entries(variants(stripped))) {
  console.log(name.padEnd(18) + String(encode(text).length).padStart(8));
}
