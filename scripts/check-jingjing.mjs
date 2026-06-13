#!/usr/bin/env node
// scripts/check-jingjing.mjs
//
// Lint zh-tw posts for 晶晶體 (decorative English mixing).
//
// Policy (see GU-LOG_WRITER_PROMPT.md §術語處理): zh-tw posts must use natural
// LHY-style Chinese. The ONLY English allowed in body/ClawdNote is:
//   1. Terms in src/data/glossary.json
//   2. Proper nouns: products, companies, labs, people, places, benchmarks,
//      model variants (hardcoded ALLOWLIST below)
//   3. Code identifiers (fenced or inline `code`)
//   4. Direct quoted English inside 「」 or "" (often source-language quotes)
//   5. Universally understood acronyms (API, SDK, CLI, PM, CEO, ML, LLM, etc.)
//
// Anything else is 晶晶體 → flag. Fix by translating to natural zh-tw, OR
// add the term to src/data/glossary.json in the same PR only if it passes
// GU-LOG_WRITER_PROMPT.md's glossary creation standard: canonical term,
// likely reused, loses meaning when translated, and useful as a stable
// gu-log mental-model anchor. A lint failure alone is never enough.
//
// Boundary ownership: adding or removing accepted English terms SHALL be
// discussed with ShroomDog first. This list encodes ShroomDog's reading-flow
// comfort, not just technical correctness; reviewers and agents must not
// silently expand or shrink it.
//
// Usage:
//   node scripts/check-jingjing.mjs <file.mdx>...
//   node scripts/check-jingjing.mjs --baseline-ref=origin/main <file.mdx>...
//   node scripts/check-jingjing.mjs                  # scans all zh-tw posts
//
// Exit codes:
//   0 — no violations (or no zh-tw files staged)
//   1 — violations found; see stderr

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __isCli =
  import.meta.url === pathToFileURL(process.argv[1] ?? '').href ||
  (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]);

const REPO_ROOT = process.cwd();
const POSTS_DIR = path.join(REPO_ROOT, 'src/content/posts');
const GLOSSARY_PATH = path.join(REPO_ROOT, 'src/data/glossary.json');

// ── Hardcoded allowlist ────────────────────────────────────────────
//
// These are English words/phrases that are universally OK in zh-tw posts
// without needing a glossary entry. Keep this list tight — when in doubt,
// add the term to glossary.json so it gets a definition + clawdNote.
// Add/remove entries only after discussing the boundary with ShroomDog.

const ALLOWLIST_RAW = `
# Universally-understood acronyms
API SDK CLI PM CEO CFO CTO COO ML LLM UI UX UI/UX SaaS REST RAG MCP Embedding
HTTP HTTPS URL URI HTML JS TS CSS DNS UDP TCP TLS SSL OAuth JWT UUID XML JSON YAML SQL OS IDE
AI AGI ASI ML/AI GA RC RL DL NN CNN RNN LSTM GAN VAE
SP CP SD Lv FAQ Q1 Q2 Q3 Q4 H1 H2
PR CI CD DevOps PR/CI Q&A FAQ TODO DONE WIP
EOL EOS DRM
GraphQL Webhook
USB SSD HDD CPU GPU TPU NPU RAM ROM VRAM
IPO M&A B2B B2C P2P D2C
KPI OKR ROI SLA SLO MTTR
N/A TBD TBA

# gu-log MDX components
ClawdNote ShroomDogNote PostImage Toggle TableOfContents ReadingProgress
PrevNextNav

# AI labs / companies / orgs
Anthropic OpenAI Google Meta Microsoft Apple Amazon AWS GCP Azure
Cloudflare Stripe Vercel Astro MDX
Browserbase
Semrush DataReportal Feishu
GitHub GitLab Bitbucket GitLab.com
DeepMind XAI Mistral DeepSeek Qwen Kimi MiniMax Cohere Stability
Hugging Face HuggingFace Replicate Modal RunPod Lambda Together Together.ai
Linear Notion Slack Gmail Calendar Discord Telegram WhatsApp Instagram Facebook Messenger
Jira
Ray-Ban Tesla Apple Samsung Sony Nintendo Mac Mobile mobile
DeepLearning.AI deeplearning.ai
LangChain LangGraph LlamaIndex Pinecone Weaviate Chroma Milvus
Scale Insilico BenevolentAI Recursion Pharmaceuticals
Eli Lilly Pfizer Moderna Roche Novartis
Insilico Medicine
Fierce Biotech
The Batch
The Verge The Register Hacker News HN HackerNews TechCrunch Wired Information Bloomberg Reuters NYTimes WSJ
Tom's Hardware
Substack Medium dev.to
Twitter X x.com twitter.com fxtwitter
Reddit StackOverflow Subreddit Reddit Answers

# Frontier models and product names
Symphony
Claude Opus Sonnet Haiku
GPT GPT-3 GPT-3.5 GPT-4 GPT-4o GPT-5 GPT-5.2 GPT-5.3 GPT-5.4
Gemini Llama Mistral Qwen DeepSeek Kimi Grok Cohere Command
# Official model names must remain canonical English; don't translate to appease lint.
Mythos
Codex Cursor Copilot Replit Bolt Lovable Devin Atlas
Autobrowse
PandaOmics Chemistry42 AlphaEvolve Concordia Gemma Nemotron NanoFold
Muse Spark Llama Maverick Sonnet Opus K2 K2.5 R1
# Model tier names (Gemini Flash, DeepSeek V4 Flash, etc.)
Flash
Agent Swarm

# Programming languages / runtimes / tools
Python JavaScript TypeScript Go Rust Zig C C++ Ruby Java Kotlin Swift Scala Elixir Erlang Haskell
Node.js Bun Deno
npm pnpm yarn pip poetry uv cargo
Linux macOS Windows iOS Android Ubuntu Debian Fedora Arch
Docker Kubernetes K8s Terraform Ansible
React Vue Angular Svelte Next.js Nuxt Remix Vite Webflow Bubble Retool
Tailwind Bootstrap shadcn shadcn/ui
PostgreSQL MySQL Redis MongoDB SQLite DuckDB
VS Code JetBrains IntelliJ PyCharm WebStorm Vim Emacs Neovim
Bash Zsh Fish Chrome DevTools
tmux monorepo BEAM OTP DAG IETF RFC
BeautifulSoup

# Benchmarks / evaluations
Intelligence Index Index Coding Index
CharXiv MMMU MMLU HumanEval GSM8K MATH GPQA SWE-bench
BrowseComp
HealthBench DeepSearchQA HLE
Humanity Last Exam Pro Hard
Artificial Analysis
NeurIPS ICML

# People (founders / authors / researchers commonly cited)
Andrew Ng Sam Altman Dario Amodei Daniela Amodei Demis Hassabis
Karpathy Andrej Andrej Karpathy
Mark Zuckerberg Elon Musk Bill Gates Paul Allen Tim Cook Steve Jobs
Sundar Pichai Satya Nadella Jensen Huang
Yann LeCun Geoffrey Hinton Yoshua Bengio
Alexandr Wang Yang Mira Mira Murati
Davide Paglieri Logan Cross Mahmoud Jake Cooper
Trump Newsom Jer Crane Pawel Pawel Huryn
Harrison Chase Simon Willison Nat Friedman Patrick Collison
Garry Tan Brian Chesky
Riley Goodside Ethan Mollick Andy Weir Ryland Grace Project Hail Mary
Alex Kotliarskyi Victor Zhu Zach Brock Karri Saarinen daniel_mac8 daniel
Jarrod Watts Matt Pocock
Lisa MindOS_Lisa
Kyle Jeong

# Places
Albuquerque Hong Kong San Francisco SF Silicon Valley
Cambridge Stanford MIT Berkeley Princeton Harvard
Beijing Shanghai Shenzhen Hangzhou Tokyo Seoul Singapore London Paris Berlin
Craigslist OpenTable Google Maps Google Drive Dropbox Drive

# Common file/format/protocol identifiers
Markdown markdown JSON YAML XML CSV TSV PDF EPUB DOCX MDX LaTeX
RSS Atom JSONFeed iCal vCard
gRPC WebSocket WebRTC GraphQL OpenAPI Swagger JSON-RPC
JWT OAuth SAML SSO 2FA MFA TOTP
SPEC.md WORKFLOW.md README.md CLAUDE.md
SSH SCP SFTP FTP IMAP SMTP POP3
Git GitHub Actions GitLab CI CircleCI Travis Jenkins

# Time / units / measure
ml mg kg km mph rpm
GB TB MB KB Mb Kb Gb Tb
ms us ns
Hz MHz GHz THz
RPM CPM BPM

# Misc commonly-fine
Inc Inc. Ltd LLC Corp Corp.
v1 v2 v3 v4 v5
beta alpha gamma RC stable
e.g. i.e. etc. vs. vs U.S. U.K. EU UK
TBA TBD TBC

# Letter abbreviations / quotes that show up legitimately
agentic
multimodal
We're
What's
Why
Life
After

# Programming-context word that has no good zh-tw equivalent in this domain
type types

# Body markdown markup that scanner may catch
import from
async await fetch
chain of thought
mode

# OCR-friendly model variant identifiers
B-IT 27B-IT 70B 8B 13B 27B 405B
xhigh
high
low
max
min

# Mode names / benchmark sub-words / variant suffixes that legitimately ride
# alongside their parent proper noun (Gemini 3.1 Pro Preview, CharXiv Reasoning,
# max reasoning, contemplating mode, Thinking mode, "Humanity's Last Exam")
Preview
Reasoning reasoning
Thinking thinking
Contemplating contemplating
Instant instant
Humanity's
tokens
app

# Research / dataset / paper names that show up as multi-word proper nouns
# (already covered by their constituent words in some cases; explicit listing
# avoids ambiguity)
Persona Generators Personas
ML Research
synthetic
Hard Pro

# gu-log persona names (not in glossary because they're meta-characters)
Clawd ShroomDog OpenClaw

# Lab / div names whose individual words look generic but are part of proper noun
Superintelligence
Project Glasswing Firefox

# Drug / medical term proper names (treatment, gene, disease canonical names)
Rentosertib Garutadustat
idiopathic pulmonary fibrosis
Phase

# Historical compound term (e.g. "BASIC interpreter")
interpreter compiler

# meta.ai is a URL/host; allow when written that way
meta.ai claude.ai openai.com anthropic.com docs.openclaw.ai

# OpenClaw automation primitive names (canonical product feature names —
# the OpenClaw docs themselves capitalize them as proper nouns; same
# status as "Claude Code" or "Pinecone"). Added 2026-04-28 for SP-186.
Task Flow Heartbeat Hooks Hook Plugin
Standing Order Orders Gateway
ACP Cron Webhook
managed mirrored

# Added 2026-04-29 for SP-188 (Mitchell Hashimoto / Ghostty leaving GitHub).
# First names of frequently-cited people; OSS git hosting platforms;
# ELK-stack tech that appears alongside outage discussion;
# Mitchell Hashimoto's other tools and the company he co-founded.
Mitchell Ghostty
Vagrant Terraform HashiCorp
Reddit FOSS
Codeberg SourceHut Forgejo Gitea
Elasticsearch
Stack Overflow
dotfiles
# Universal git verbs/nouns with no clean single-word zh-tw equivalent —
# all gu-log readers know these from daily git use, same status as PR/merge/branch.
commit
# OSS signing protocol Mitchell uses for Ghostty releases (covered in CP-159);
# X handle of SP-169's source author.
Vouch dani
# Added 2026-06-12 for SP-221 (Zed DeltaDB). Zed = editor/company, DeltaDB =
# the product, Nathan Sobo = founder; "delta" is DeltaDB's namesake atomic
# unit (the article's core abstraction, analogous to commit) — keeping the
# English preserves the tie to the product name.
Zed DeltaDB Nathan Sobo delta

# Added 2026-05-07 for SP-191 (Claude Dreams / context rot).
# Dreams is Anthropic's Managed Agents memory-consolidation feature; danizhu is
# the source handle. "Agents" covers pluralized glossary term false positives.
Dreams dream
Managed Agents Agents
danizhu
context rot
# Added 2026-06-13 for CP-308 (Fable 5 / Mythos 5 export control).
# X handle of the cited add-on commentary author (the timeline + ITAR parallel).
gothburz

# Added 2026-06-12 for SP-222 (Simon Willison / Fable relentlessly proactive).
# Fable = Claude model name (sibling of allowlisted Opus/Sonnet/Haiku).
# Browsers / engines / automation siblings of allowlisted Firefox/Chrome.
# Datasette/PyObjC/SwiftUI/AgentsView = products & libraries; osascript/grep =
# canonical CLI tools (grep is universal, same status as allowlisted "commit").
# Web Component + Shadow DOM = W3C web-platform proper nouns. injection covers
# the canonical "prompt injection" term. Johann Rehberger + Normalization /
# Deviance = the cited essay "The Normalization of Deviance in AI". relentlessly
# = the source post's titular phrase, introduced then translated inline.
Fable
Safari Playwright WebKit
Datasette PyObjC SwiftUI AgentsView
osascript grep
Web Component Shadow
injection
Johann Rehberger Normalization Deviance
relentlessly

# Added 2026-05-12 for SP-197 (Garry Tan AI agent complexity ratchet).
# Proper nouns, source examples, research author names, and literal prior article titles.
Conductor Dave Bitcoin Jared Podcast
Eval-Driven Development
Capers Jones Mockus Nagappan Dinh-Trong Vista Level
Fat Thin Resolvers Controversy Naked Stupider Manifesto

# Added 2026-05-11 for SP-196 (Garry Tan meta-meta-prompting / GBrain).
# Proper nouns, product/framework names, benchmark names, source book titles,
# and source-quoted workflow names. These should remain English for fidelity.
ChatGPT
Pema Chodron Chödrön Ch dr drön
When Things Fall Apart Things Fall Apart
LinkedIn
Y Combinator Combinator
GBrain GStack Skillify
Dion Lim Amplified Bertrand Russell Designing Your Life Finite Infinite Games Hesse Feynman Ken Wilber
James
Sebastian Mallaby
perplexity-research
Hermes Agent Hermes
Pi Tailscale Render Railway
LLM Wiki LongMemEval MemPalace

# Added 2026-04-30 for SP-189 (OpenAI GPT-5.5 prompting guide).
# Canonical AI / prompt-engineering terms named explicitly in OpenAI's docs
# (these are the article's literal subject — translating them would lose
# fidelity to the source material that names them in English).
preamble preambles
retrieval budget budgets
decision rule rules
stopping condition conditions
phase parameter
apply_patch named function
first-class first
post-train post-trained post-training
metaprompting metaprompt
outcome-first intent-first process-heavy
multi-step tool-heavy long-running
tool call calls
system prompt
few-shot
instruction adherence
streaming
override
codebase
hardcoded
patch
Cognition
freeform server-defined
context-free grammar
file editor codeexec
Computer Use
verbosity
gather
SOP
operations
diff diffs
header headers
takeaway takeaways
review test tests refactor
audit
train trained trains training
output outputs
coverage filter
skill skills
log logs
bug bugs
final answer commentary
replay
item items
integration
troubleshooting
parameter parameters
fine-tune fine-tuned fine-tuning
status update updates
post-task summary summaries

# Common dev / engineering English universally understood by gu-log readers
# (same status as 'commit' — used in Mandarin tech writing without translation).
engineer engineers
team teams
vendor vendors
production prod
latency
accuracy
release releases
note notes
mode modes
condition conditions
check checks
history
migrate migrate-to migration migrations
block blocks
friendly proactive
tone
software
Inception
viral
routing orchestration
routine routines
gather
role roles
rule rules
safety
declarative procedural
list comprehension
if-else
override
dashboard
channel
lead
manager
off-by-one
skip flag
prod
release manager
tag tags
cap
search
policy
issue issues
severity
laptop
forever
guide
blog
post posts
doc docs
cheat sheet
release note
product surface
user experience
goals
context
planning
workflow workflows
spec specs
best practice practices
case cases
failure mode modes
application app apps
request requests
overthinking
loggy
phrasing
awkward

# OpenAI-named prompt keywords / API surface (referenced in the article as
# the literal English terms users see in OpenAI docs).
ALWAYS NEVER always never must only
Personality personality
Collaboration collaboration
style
assistant chatbot
first-token
Responses
description
pipeline
eval evals evaluation
step-by-step
apply
format formats
opening
SOP
`;

const HARDCODED = new Set();
for (const tok of ALLOWLIST_RAW.split(/\s+/)) {
  const t = tok.trim();
  if (!t || t.startsWith('#')) continue;
  HARDCODED.add(t);
}

// ── Glossary terms ─────────────────────────────────────────────────

const GLOSSARY_TERMS = new Set();
try {
  const glossary = JSON.parse(fs.readFileSync(GLOSSARY_PATH, 'utf8'));
  for (const t of glossary) {
    if (t.term) {
      GLOSSARY_TERMS.add(t.term);
      // Also add individual words from multi-word terms
      for (const w of t.term.split(/\s+/)) GLOSSARY_TERMS.add(w);
    }
    if (t.en && t.en !== t.term) {
      GLOSSARY_TERMS.add(t.en);
      for (const w of t.en.split(/\s+/)) GLOSSARY_TERMS.add(w);
    }
  }
} catch (e) {
  console.error(`[check-jingjing] Failed to load glossary at ${GLOSSARY_PATH}: ${e.message}`);
  process.exit(2);
}

// ── Helpers ────────────────────────────────────────────────────────

function isAllowed(word) {
  // Strip trailing punctuation
  const w = word.replace(/[.,;:!?'"]+$/, '');

  // Empty after strip
  if (!w) return true;

  // Pure number or contains period (likely number/version) — allow
  if (/^[\d.]+$/.test(w)) return true;

  // Single character
  if (w.length === 1) return true;

  // All-uppercase short acronym (≤ 6 chars)
  if (w.length <= 6 && /^[A-Z][A-Z0-9-]*$/.test(w)) return true;

  // Mixed-case identifier with numbers/hyphens (versions like GPT-5.4, B-IT, K2.5)
  if (/[0-9]/.test(w) && /[A-Za-z]/.test(w)) return true;

  // Hardcoded allowlist
  if (HARDCODED.has(w)) return true;

  // Glossary
  if (GLOSSARY_TERMS.has(w)) return true;

  // case-insensitive glossary fallback (allow "token" if "Token" is in glossary)
  const lower = w.toLowerCase();
  for (const term of GLOSSARY_TERMS) {
    if (term.toLowerCase() === lower) return true;
  }
  for (const term of HARDCODED) {
    if (term.toLowerCase() === lower) return true;
  }

  return false;
}

function maskContent(text) {
  // Returns text with masked regions replaced by spaces (preserving line numbers)
  // Mask: frontmatter, code blocks, blockquotes, inline code, direct English quotes inside 「」 or ""
  // Keep: body prose, ClawdNote inner prose, ShroomDogNote inner prose

  // 1. Mask frontmatter (--- ... ---)
  const fmMatch = text.match(/^---\n[\s\S]*?\n---\n/);
  if (fmMatch) {
    text = ' '.repeat(fmMatch[0].length).replace(/[^\n]/g, ' ') + text.slice(fmMatch[0].length);
    // Preserve newlines
    let masked = '';
    for (let i = 0; i < fmMatch[0].length; i++) {
      masked += fmMatch[0][i] === '\n' ? '\n' : ' ';
    }
    text = masked + text.slice(fmMatch[0].length);
  }

  // 2. Mask code blocks ``` ... ```
  text = text.replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, ' '));
  text = text.replace(/~~~[\s\S]*?~~~/g, (m) => m.replace(/[^\n]/g, ' '));

  // 3. Mask inline code `...`
  text = text.replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length));

  // 4. Mask blockquote lines (lines starting with >)
  text = text.replace(/^> .*$/gm, (m) => ' '.repeat(m.length));

  // 5. Mask import lines and HTML/MDX tags themselves (but NOT their inner text)
  text = text.replace(/^import .*$/gm, (m) => ' '.repeat(m.length));
  // Mask HTML/MDX opening/closing tags (e.g. <ClawdNote>, </ClawdNote>) but leave inner content
  text = text.replace(/<\/?[A-Za-z][^>]*>/g, (m) => ' '.repeat(m.length));

  // 6. Mask markdown link URL part [text](url) — keep text, drop URL
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, (_m, txt) => {
    // Keep text portion in original visual position; rest of link as space
    const orig = _m;
    return txt + ' '.repeat(orig.length - txt.length);
  });

  // 7. Mask direct quoted English inside 「...」 or "..."
  // Heuristic: if quote contains predominantly Latin letters and spaces, mask it
  text = text.replace(/「[^」\n]*」/g, (m) => {
    const inner = m.slice(1, -1);
    const latinRatio = (inner.match(/[A-Za-z]/g) || []).length / Math.max(inner.length, 1);
    return latinRatio > 0.5 ? ' '.repeat(m.length) : m;
  });
  text = text.replace(/"[^"\n]*"/g, (m) => {
    const inner = m.slice(1, -1);
    const latinRatio = (inner.match(/[A-Za-z]/g) || []).length / Math.max(inner.length, 1);
    return latinRatio > 0.5 ? ' '.repeat(m.length) : m;
  });

  return text;
}

function checkText(raw, filePath = '') {
  const violations = [];

  // Skip en- posts entirely
  const base = path.basename(filePath);
  if (base.startsWith('en-')) return { violations: [], skipped: true };

  // Verify lang: zh-tw in frontmatter
  const langMatch = raw.match(/^lang:\s*["']?(zh-tw|en)["']?/m);
  if (langMatch && langMatch[1] === 'en') return { violations: [], skipped: true };

  const masked = maskContent(raw);
  const lines = raw.split('\n');
  const maskedLines = masked.split('\n');

  // Find English word sequences in masked content
  for (let i = 0; i < maskedLines.length; i++) {
    const mLine = maskedLines[i];
    // Match English words: latin letters with optional digits/hyphens/dots/apostrophes
    const matches = [...mLine.matchAll(/[A-Za-z][A-Za-z0-9'-]*\.?[A-Za-z0-9]*/g)];
    for (const m of matches) {
      const word = m[0];
      if (!isAllowed(word)) {
        violations.push({
          line: i + 1,
          word,
          context: lines[i].trim().slice(0, 140),
        });
      }
    }
  }

  return { violations };
}

function checkFile(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return { violations: [], error: e.message };
  }
  return checkText(raw, filePath);
}

function violationKey(v) {
  return `${v.word.toLowerCase()}\0${v.context.replace(/\s+/g, ' ').trim()}`;
}

function readBaselineFile(repoRelative, baselineRef) {
  return execFileSync('git', ['show', `${baselineRef}:${repoRelative}`], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

function ensureRemoteBaselineRef(baselineRef) {
  const match = baselineRef.match(/^origin\/(.+)$/);
  if (!match) return;
  const branch = match[1];
  execFileSync('git', ['fetch', 'origin', `${branch}:refs/remotes/origin/${branch}`, '--depth=1'], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'ignore', 'ignore'],
  });
}

function getBaselineViolations(filePath, baselineRef) {
  if (!baselineRef) return new Set();

  const repoRelative = path.relative(REPO_ROOT, path.resolve(filePath));
  try {
    const raw = readBaselineFile(repoRelative, baselineRef);
    const { violations } = checkText(raw, filePath);
    return new Set(violations.map(violationKey));
  } catch {
    try {
      ensureRemoteBaselineRef(baselineRef);
      const raw = readBaselineFile(repoRelative, baselineRef);
      const { violations } = checkText(raw, filePath);
      return new Set(violations.map(violationKey));
    } catch {
      // New file or unavailable baseline: all violations are new.
      return new Set();
    }
  }
}

// ── Exports for tests ──────────────────────────────────────────────
export { isAllowed, maskContent, checkText, checkFile };

// ── Main ───────────────────────────────────────────────────────────

if (!__isCli) {
  // Stop here when imported as a module (e.g. from tests).
  // The remaining file is the CLI entry point.
} else {
  const args = process.argv.slice(2).filter(Boolean);
  const baselineArg = args.find((arg) => arg.startsWith('--baseline-ref='));
  const explicitBaselineRef = baselineArg?.slice('--baseline-ref='.length) || '';
  const ciBaselineRef =
    process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_BASE_REF
      ? `origin/${process.env.GITHUB_BASE_REF}`
      : '';
  const baselineRef = explicitBaselineRef || ciBaselineRef;
  let files = args.filter((arg) => !arg.startsWith('--baseline-ref='));

  if (files.length === 0) {
    // Scan all zh-tw posts
    if (!fs.existsSync(POSTS_DIR)) {
      console.error(`[check-jingjing] No posts dir at ${POSTS_DIR}`);
      process.exit(0);
    }
    files = fs
      .readdirSync(POSTS_DIR)
      .filter((f) => f.endsWith('.mdx') && !f.startsWith('en-'))
      .map((f) => path.join(POSTS_DIR, f));
  }

  let totalViolations = 0;
  const filesWithViolations = [];

  for (const filePath of files) {
    const { violations, error, skipped } = checkFile(filePath);
    if (error) {
      console.error(`[check-jingjing] ${filePath}: ${error}`);
      process.exit(2);
    }
    if (skipped) continue;
    const baselineViolations = getBaselineViolations(filePath, baselineRef);
    const newViolations = baselineViolations.size
      ? violations.filter((v) => !baselineViolations.has(violationKey(v)))
      : violations;
    if (newViolations.length === 0) continue;

    filesWithViolations.push({ filePath, violations: newViolations });
    totalViolations += newViolations.length;
  }

  if (totalViolations === 0) {
    console.log(
      `✓ check-jingjing: ${files.length} file(s) clean${baselineRef ? ` vs ${baselineRef}` : ''}`
    );
    process.exit(0);
  }

  // Report
  console.error(
    `\n❌ 晶晶體 violations in ${filesWithViolations.length} file(s) (${totalViolations} total):\n`
  );
  for (const { filePath, violations } of filesWithViolations) {
    console.error(`📄 ${path.relative(REPO_ROOT, filePath)}`);
    // Group by line
    const byLine = new Map();
    for (const v of violations) {
      if (!byLine.has(v.line)) byLine.set(v.line, []);
      byLine.get(v.line).push(v);
    }
    for (const [line, vs] of [...byLine.entries()].sort((a, b) => a[0] - b[0])) {
      const words = [...new Set(vs.map((v) => v.word))];
      console.error(`  L${line}: ${words.join(', ')}`);
      console.error(`    │ ${vs[0].context}`);
    }
    console.error('');
  }

  console.error(
    `Fix options:\n` +
      `  1. Translate to natural zh-tw (preferred — see GU-LOG_WRITER_PROMPT.md §術語處理).\n` +
      `  2. If genuinely a canonical/reusable term, apply GU-LOG_WRITER_PROMPT.md's glossary creation standard, discuss the boundary with ShroomDog, then add to src/data/glossary.json with definition + clawdNote.\n` +
      `  3. If proper noun (product/people/lab) misclassified, discuss with ShroomDog before adding to ALLOWLIST_RAW in scripts/check-jingjing.mjs.\n` +
      (baselineRef
        ? `\nNote: --baseline-ref=${baselineRef} was used, so only new violations are reported; historical grandfathered violations are ignored.\n`
        : '')
  );
  process.exit(1);
} // end CLI guard
