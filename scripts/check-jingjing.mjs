#!/usr/bin/env node
// scripts/check-jingjing.mjs
//
// Lint zh-tw posts for 晶晶體 (decorative English mixing).
//
// Policy (see GU-LOG_WRITER_PROMPT.md §術語處理): zh-tw posts must use natural
// LHY-style Chinese. The ONLY English allowed in body/MoguNote is:
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
// add the term to glossary.json so it gets a definition + moguNote.
// Add/remove entries only after discussing the boundary with ShroomDog.

const ALLOWLIST_RAW = `
# Universally-understood acronyms
API SDK CLI PM CEO CFO CTO COO ML LLM UI UX UI/UX SaaS REST RAG MCP Embedding
HTTP HTTPS URL URI HTML JS TS CSS DNS UDP TCP TLS SSL OAuth JWT UUID XML JSON YAML SQL OS IDE
AI AGI ASI ML/AI GA RC RL DL NN CNN RNN LSTM GAN VAE
GP MP SD Lv FAQ Q1 Q2 Q3 Q4 H1 H2
PR CI CD DevOps PR/CI Q&A FAQ TODO DONE WIP
EOL EOS DRM
GraphQL Webhook
USB SSD HDD CPU GPU TPU NPU RAM ROM VRAM
IPO M&A B2B B2C P2P D2C
KPI OKR ROI SLA SLO MTTR
# xG = football expected-goals metric (same status as KPI/OKR — translating loses meaning)
# Phil Chen career-advice post (2026-07-03)
xG
N/A TBD TBA

# gu-log MDX components
MoguNote ShroomDogNote PostImage Toggle TableOfContents ReadingProgress
PrevNextNav

# AI labs / companies / orgs
Anthropic OpenAI Google Meta Microsoft Apple Amazon AWS GCP Azure
Cloudflare Stripe Vercel Astro MDX
OpenRouter Perplexity Exa Parallel
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
# Helm AI — Phil Chen career-advice post (2026-07-03)
Helm
Eli Lilly Pfizer Moderna Roche Novartis
Insilico Medicine
Fierce Biotech
The Batch
The Verge The Register Hacker News HN HackerNews TechCrunch Wired Information Bloomberg Reuters NYTimes WSJ
Fortune Brainstorm
Tom's Hardware
Substack Medium dev.to
Twitter X x.com twitter.com fxtwitter
Reddit StackOverflow Subreddit Reddit Answers

# Frontier models and product names
Symphony Fusion
Claude Opus Sonnet Haiku
GPT GPT-3 GPT-3.5 GPT-4 GPT-4o GPT-5 GPT-5.2 GPT-5.3 GPT-5.4
Gemini Llama Mistral Qwen DeepSeek Kimi Grok Cohere Command
# Official model names must remain canonical English; don't translate to appease lint.
Mythos
Codex Cursor Copilot Replit Bolt Lovable Devin Atlas
# Slackbot = Anthropic's first product demo named in the source
# Phil Chen career-advice post (2026-07-03)
Slackbot
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
Davide Paglieri Logan Cross Mahmoud Jake Cooper Pascal
Trump Newsom Jer Crane Pawel Pawel Huryn
Harrison Chase Simon Willison Nat Friedman Patrick Collison Shihipar
Garry Tan Brian Chesky
Riley Goodside Ethan Mollick Andy Weir Ryland Grace Project Hail Mary
Alex Kotliarskyi Victor Zhu Zach Brock Karri Saarinen daniel_mac8 daniel
Jarrod Watts Matt Pocock
Lisa MindOS_Lisa
Dimillian Thomas Ricouard
Kyle Jeong
# Behavioral-economics / happiness researchers cited in GP-243
Kahneman Deaton Angus Killingsworth
# Phil Chen career-advice post (2026-07-03): the author, his ex-colleague Vlad
# Feinberg (Gemini lead), Alfred Lin (Sequoia), Michael (Truell) + Aman (Sanger)
# = Cursor founders' first names as cited in the source
Phil Chen Vlad Feinberg Alfred Lin Michael Aman
# Ryo Lu — Cursor Head of Design, cited author of GP-30 + the MP
# when-the-dream-becomes-the-job post (2026-07-15)
Ryo Lu

# Places
Albuquerque Hong Kong San Francisco SF Silicon Valley
Cambridge Stanford MIT Berkeley Princeton Harvard
Beijing Shanghai Shenzhen Hangzhou Tokyo Seoul Singapore London Paris Berlin
Craigslist OpenTable Google Maps Google Drive Dropbox Drive Pinterest

# Common file/format/protocol identifiers
Markdown markdown JSON YAML XML CSV TSV PDF EPUB DOCX MDX LaTeX
RSS Atom JSONFeed iCal vCard
gRPC WebSocket WebRTC GraphQL OpenAPI Swagger JSON-RPC
JWT OAuth SAML SSO 2FA MFA TOTP
SPEC.md WORKFLOW.md README.md CLAUDE.md SKILL.md AGENTS.md CONTRIBUTING.md
SSH SCP SFTP FTP IMAP SMTP POP3
Git GitHub Actions GitLab CI CircleCI Travis Jenkins
WebAssembly Wasm itms-services

# Apple ecosystem / iOS app distribution (added 2026-06-26 for MP AssppWeb post)
App Store TestFlight IPA
AssppWeb Asspp ipatool
# Time / units / measure
ml mg kg km mph rpm
GB TB MB KB Mb Kb Gb Tb
ms us ns
Hz MHz GHz THz
RPM CPM BPM

# Greek/foreign term italicized + glossed inline in body (GP-243 伊比鳩魯 ataraxia)
ataraxia
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
Mogu ShroomDog OpenClaw

# Product / feature / handle proper nouns (Codex ecosystem; GP-210)
Storybook Remotion Studio Chronicle jxnlco
# "center of gravity" — quoted source phrase (jxnlco's own wording)
center gravity

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
# status as "Claude Code" or "Pinecone"). Added 2026-04-28 for GP-186.
Task Flow Heartbeat Hooks Hook Plugin
Standing Order Orders Gateway
ACP Cron Webhook
managed mirrored

# Added 2026-04-29 for GP-188 (Mitchell Hashimoto / Ghostty leaving GitHub).
# First names of frequently-cited people; OSS git hosting platforms;
# ELK-stack tech that appears alongside outage discussion;
# Mitchell Hashimoto's other tools and the company he co-founded.
# Extended 2026-07-21 for SP (Building Block Economy): Hashimoto = the surname
# of already-allowed Mitchell; libghostty = Ghostty's library, a code identifier
# and the literal subject of the post — same accepted author/product boundary.
Mitchell Hashimoto Ghostty libghostty
Vagrant Terraform HashiCorp
Reddit FOSS
Codeberg SourceHut Forgejo Gitea
Elasticsearch
Stack Overflow
dotfiles
# Universal git verbs/nouns with no clean single-word zh-tw equivalent —
# all gu-log readers know these from daily git use, same status as PR/merge/branch.
commit
# OSS signing protocol Mitchell uses for Ghostty releases (covered in MP-159);
# X handle of GP-169's source author.
Vouch dani
# Added 2026-06-22 for GP-239 (Ghostty startup tradeoffs). D-Bus = the Linux
# desktop message bus, a genuine proper noun Mitchell names in the source
# ("registration (dbus)"); reusable across future Linux/terminal articles.
D-Bus
# Added 2026-06-12 for GP-221 (Zed DeltaDB). Zed = editor/company, DeltaDB =
# the product, Nathan Sobo = founder; "delta" is DeltaDB's namesake atomic
# unit (the article's core abstraction, analogous to commit) — keeping the
# English preserves the tie to the product name.
Zed DeltaDB Nathan Sobo delta
# Added 2026-06-13 for GP-224 (self-repairing agent harness). Opik = the
# open-source observability/repair platform (comet-ml/opik), Ollie = its
# built-in coding agent, CrewAI = a multi-agent framework cited alongside
# LangGraph. All product/feature proper nouns.
Opik Ollie CrewAI

# Added 2026-05-07 for GP-191 (Claude Dreams / context rot).
# Dreams is Anthropic's Managed Agents memory-consolidation feature; danizhu is
# the source handle. "Agents" covers pluralized glossary term false positives.
Dreams dream
Managed Agents Agents
danizhu
context rot
# Added 2026-06-13 for MP-308 (Fable 5 / Mythos 5 export control).
# X handle of the cited add-on commentary author (the timeline + ITAR parallel).
gothburz

# Added 2026-06-12 for GP-222 (Simon Willison / Fable relentlessly proactive).
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

# Added 2026-06-17 for GP-232 (mvanhorn "WTF Is a Loop?" loop-engineering lineage).
# Company names (Uber budget cap, Gartner hype-cycle stat), person names cited in
# the discourse (Steve Yegge, Matthew Berman, DanKornas), and product/feature
# proper nouns (Gas Town = Yegge's orchestration system, roborev = Kornas's
# background commit-review tool). All proper nouns named in the source.
Uber Gartner Yegge Matthew Berman DanKornas
Gas Town roborev
# AutoGPT = the 2023 goal-loop project; Huntley = Geoffrey Huntley, ralph loop's
# author. Both are proper nouns anchoring the loop lineage section.
AutoGPT Huntley

# Added 2026-05-12 for GP-197 (Garry Tan AI agent complexity ratchet).
# Proper nouns, source examples, research author names, and literal prior article titles.
Conductor Dave Bitcoin Jared Podcast
Eval-Driven Development
Capers Jones Mockus Nagappan Dinh-Trong Vista Level
Fat Thin Resolvers Controversy Naked Stupider Manifesto

# Added 2026-05-11 for GP-196 (Garry Tan meta-meta-prompting / GBrain).
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

# Added 2026-04-30 for GP-189 (OpenAI GPT-5.5 prompting guide).
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

# Added 2026-06-17 for GP (kvnkld "10 rules to ship polished UI").
# kvnkld = X handle of the source author. Figma = the design tool the post
# centers on (product proper noun, sibling of allowlisted Datasette/Zed).
kvnkld Figma

# Added 2026-06-17 for MP (rahulgs "english -> code interpreters" thread).
# rahulgs = X handle of the source author (proper noun, same pattern as kvnkld).
rahulgs

# Added 2026-06-18 for GP (samueljmcd "verifier is the product").
# ReAct and Reflexion are now glossary terms (src/data/glossary.json), so they
# are auto-allowed via the glossary loader below — no hardcode needed. Posts
# link them to /glossary#react and /glossary#reflexion, which carry the arXiv
# links. Pattern: canonical external references route through the glossary
# (definition + moguNote + url), not direct outbound links from the post body.
# Jarred Sumner = Bun's creator (person, proper noun). struct / lifetime =
# canonical Rust language keywords named in the port story (same status as the
# allowlisted programming-language tokens). These are not glossary-worthy
# (one-off mentions, not reusable canonical references), so they stay here.
Jarred Sumner
struct lifetime

# Added 2026-06-22 for GP-240 (championswimmer process-vs-outcome / AI breaking
# the peace). Shia LaBeouf = the actor behind the "Just do it" meme the source
# cites (person, proper noun). Tropicana = the juice brand the lemonade-stand
# analogy scales up into (company/product, proper noun). Both are one-off
# proper-noun references named in the source, same category as the people /
# company names already allowlisted above.
Shia LaBeouf
Tropicana

# Added 2026-06-22 for GP-242 (Sakana Fugu orchestration "AI sovereignty" vs
# Elie Bakouch's teardown). All proper nouns named in the two sources:
# Sakana = the Japanese AI lab (company). Fugu / Ultra = the product and its
# variant (Fugu Ultra). Elie Bakouch = the researcher behind the critique
# (person). AutoResearch / TerminalBench / Bench (SWE Bench Pro) = benchmark
# names cited from the tech report. Same category as the lab / product / person
# / benchmark names already allowlisted above; none has a zh-tw translation.
Sakana Fugu Ultra
Elie Bakouch
AutoResearch TerminalBench Bench

# Added 2026-06-22 for MP-310 (Alisa Liu's NLP-PhD industry job-search notes).
# All bona-fide proper nouns named in the single source, none with a natural
# zh-tw translation (writer-prompt rule #2: people / libraries / products /
# course + article titles stay English):
#   Alisa Liu = the author (person). Lambert = Nathan Lambert, cited author.
#   PyTorch / numpy = the ML libraries an interview tests. transformer /
#   tokenizer / tokenization = canonical architecture + her research specialty.
#   LeetCode / Neetcode / Blind (75) = interview-prep resources. Modeling /
#   Scratch = the Stanford course title "Language Modeling from Scratch".
#   Industry / Job = words in the source article title "Notes on the Industry
#   Job Search" as it appears in the citation link.
Alisa Liu Lambert
PyTorch numpy transformer tokenizer tokenization
LeetCode Neetcode Blind
Modeling Scratch Industry Job

# Added 2026-07-01 for MP-312 (Kun Chen's firstmate/secondmate/crewmate agent
# org chart + per-task model routing). Kun Chen = the author (person), no
# natural zh-tw translation (writer-prompt rule #2: people stay English).
Kun Chen

# Added 2026-07-13 for GP-255 (Nadella tweet). Proper nouns named in the
# source (writer-prompt rule #2: people / companies stay English):
#   Kenneth Arrow = Nobel economist, original information-paradox author.
#   Karp = Alex Karp, Palantir CEO ("Alex" is already allowlisted above).
#   Palantir = the company (same category as the labs above).
# "Reverse Information Paradox" = the coined term the whole post is about;
# translating away the original name loses searchability (xG-style rationale).
Kenneth Arrow Karp Palantir
Reverse Information Paradox

# Added 2026-07-01 for the Core-dump Lv 三部曲 (levelup-*-core-dump-*). All
# bona-fide proper nouns named in the OpenAI source, none with a zh-tw
# translation (same category as the product / library names already
# allowlisted above):
#   Rockset = OpenAI's C++ data service (acquired 2024) — the product the whole
#     series debugs. libunwind = the GNU stack-unwinding library that carried
#     the 18-year-old race (the "18 歲的鬼"). Level-Up = the gu-log tutorial
#     series brand, same house-term status as MoguNote / ShroomDogNote above.
#   folly = Facebook/Meta's open-source C++ library (its fatal signal handler
#     logs the stack trace) — product/library proper noun like libunwind.
#   John Snow / Broad Street = the physician + London street of the 1854 cholera
#     pump, the founding story of epidemiology (Post B's bug #1 analogy anchor).
#   Unix = the OS family named when cross-linking the Unix-signals Lv post.
Rockset libunwind Level-Up
folly
John Snow Broad Street
Unix
#   Enrico Fermi = the physicist behind "Fermi estimation" (order-of-magnitude
#     back-of-envelope estimate), named in Post C's MoguNote — person, proper noun.
Enrico Fermi

# Added 2026-06-20 for SD (Dan Koe spec-driven-life riff). Dan Koe = the source
# author (person, X handle @thedankoe). Spec Kit (GitHub) and Kiro (Amazon) =
# product names for the two spec-driven dev tools cited. cybernetics / kybernetes
# = the Greek/English etymology the piece explicitly discusses alongside the
# already-allowlisted Kubernetes (same word root). All proper nouns / named terms
# under discussion, not decorative English.
Dan Koe
Spec Kit
Kiro
cybernetics kybernetes
# @thedankoe = source X handle; the bracketed English string is the verbatim
# title of the cited article, given with a zh-tw gloss right after (direct-quote
# attribution, GU-LOG_WRITER_PROMPT §術語處理 rule 3).
thedankoe

# Added 2026-07-03 for GP (Geoffrey Litt understand-agent-code thread).
# All people (writer-prompt rule #2): Geoffrey Litt = source author (@geoffreylitt,
# Notion engineer); Seymour Papert = education pioneer (Mathland / Logo);
# Alan Kay = computing pioneer (Dynabook vision cited in the thread);
# Andy Matuschak = "Books don't work" essayist; Margaret Storey = researcher
# credited (with Simon Willison) for popularizing "Cognitive Debt".
Geoffrey Litt
Seymour Papert
Alan Kay
Andy Matuschak
Margaret Storey
How fix your entire life in day

# Added 2026-07-09 for GP-253 (TypeScript 7.0 Go port announcement). All
# bona-fide proper nouns named in the Microsoft source, none with a zh-tw
# translation (writer-prompt rule #2: people / products / companies stay
# English; same categories as the company / tool / person names above):
#   Sentry / Canva / Vanta / Bluesky / PowerBI = companies whose migration
#     numbers the announcement cites. Parcel = the bundler whose C++ file
#     watcher was ported to Go. Turbopack / Biome / Volar / esbuild / swc /
#     jest / ESLint / typescript-eslint = the JS toolchain products named in
#     the ecosystem-impact section (tool proper nouns, sibling of Vite/Webpack
#     status above).
#   Devon Govett = Parcel's creator (person).
#   ECMAScript / Unicode / JSDoc = standards / spec proper nouns (sibling of
#     the allowlisted WebAssembly / OpenAPI).
#   goroutine = canonical Go language keyword (same status as the struct /
#     lifetime Rust tokens above). Workers / Worker = Web Workers, the
#     canonical browser API name. Visual = Visual Studio (Studio already
#     allowlisted above). Closure = Google Closure Compiler annotation style.
#   Services = part of the "Microsoft News Services" team proper noun (same
#     pattern as Modeling / Scratch title words above).
Sentry Canva Vanta Bluesky PowerBI
Parcel Turbopack Biome Volar esbuild swc jest
ESLint eslint typescript-eslint
Devon Govett
ECMAScript Unicode JSDoc
goroutine
Workers Worker
Visual Closure
Services
#   Webpack / Babel = the JS-era toolchain products the MoguNote contrasts
#     with the Rust/Go wave (tool proper nouns, sibling of Vite / React above).
Webpack Babel
#   surrogate pair = Unicode spec term glossed inline right after its zh-tw
#     translation 代理對 (same status as the allowlisted ataraxia gloss).
surrogate pair

# Added 2026-07-15 for the Claude Tag + OpenClaw self-host series (LINE / Teams /
# security). All bona-fide proper nouns — companies, products, or canonical
# named features in the sources, none with a zh-tw translation (writer-prompt
# rule #2: people / products / companies / named features stay English):
#   Mattermost / Rocket.Chat = self-hostable team-chat products (OpenClaw channels).
#   ClawHub = OpenClaw's skill marketplace (proper product name).
#   Censys / Bitsight / PromptArmor = security research firms cited for the 2026
#     exposed-instance scan counts + the prompt-injection write-up.
#   ngrok / cloudflared / Caddy = tunnelling / reverse-proxy products.
#   worktree = canonical git term (sibling of the allowlisted monorepo / goroutine).
#   pod = Kubernetes pod (sibling of the allowlisted K8s / Kubernetes / Docker).
#   Exchange / Graph / Bot Framework = Microsoft product / API / SDK proper nouns
#     (Microsoft Exchange server, Microsoft Graph API, Azure Bot Framework).
#   Agent Proxy / Access bundle = Anthropic Claude Tag feature names, referenced
#     by name across all four posts (Agent already allowlisted via Agent Swarm).
#   Flex = LINE Flex Message component name.
Mattermost Rocket.Chat ClawHub
Censys Bitsight PromptArmor
ngrok cloudflared Caddy
worktree pod
Exchange Graph Bot Framework
Agent Proxy Access bundle
Flex
#   localhost / cross-origin = canonical networking terms whose zh-tw renderings
#     lose precision (sibling of the allowlisted TCP / TLS / HTTP / DNS / OAuth).
#   Let's Encrypt = the free CA product named in the reverse-proxy section.
localhost cross-origin
Let's Encrypt
#   OneDrive / Outlook = Microsoft product proper nouns (Graph API scopes named
#     in the Teams post). DMZ = canonical network-security acronym (sibling of
#     the allowlisted VPN-class terms); glossed 非軍事區 inline on first use.
OneDrive Outlook DMZ
#   LINE Developers / Messaging API = LINE's developer-console + product-API
#     proper nouns (same category as the Microsoft product names above).
Developers Messaging
`;

const HARDCODED = new Set();
for (const line of ALLOWLIST_RAW.split('\n')) {
  const trimmedLine = line.trim();
  // Skip full-line comments before tokenizing — a line-level check is
  // required because splitting the whole blob on whitespace first would
  // scatter each comment line's prose words into the token stream, with
  // only the leading '#' itself filtered out (the original bug: comment
  // text silently became "accepted English").
  if (!trimmedLine || trimmedLine.startsWith('#')) continue;
  for (const tok of trimmedLine.split(/\s+/)) {
    if (!tok) continue;
    HARDCODED.add(tok);
  }
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
  // Keep: body prose, MoguNote inner prose, ShroomDogNote inner prose

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

  // 2b. Mask JSX template-literal props (e.g. <Mermaid chart={`...`} />).
  // The diagram/code source passed as a prop is not reader prose. The generic
  // tag mask in step 5 only reaches the first '>', which here sits INSIDE the
  // chart (`<br/>`, `-->`), so the diagram body would otherwise leak through
  // and get scanned (fill/stroke/color/node labels → false positives).
  text = text.replace(/=\{`[\s\S]*?`\}/g, (m) => m.replace(/[^\n]/g, ' '));

  // 3. Mask inline code `...`
  text = text.replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length));

  // 4. Mask blockquote lines (lines starting with >)
  text = text.replace(/^> .*$/gm, (m) => ' '.repeat(m.length));

  // 5. Mask import lines and HTML/MDX tags themselves (but NOT their inner text)
  text = text.replace(/^import .*$/gm, (m) => ' '.repeat(m.length));
  // Mask HTML/MDX opening/closing tags (e.g. <MoguNote>, </MoguNote>) but leave inner content
  text = text.replace(/<\/?[A-Za-z][^>]*>/g, (m) => ' '.repeat(m.length));

  // 5b. Mask cross-link list items (the auto-generated 延伸閱讀 / Related list).
  // A bullet whose entire content is a single markdown link quotes ANOTHER
  // post's title in the anchor text (e.g. MP-85「AI Vampire…」). English there
  // belongs to that post — and is governed by that post's own jingjing run —
  // not to this post's prose, so mask the whole line. Inline links inside
  // flowing prose are left alone by this rule and still get scanned (step 6).
  text = text.replace(/^\s*[-*+]\s*\[[^\]\n]*\]\([^)\n]*\)\s*$/gm, (m) => ' '.repeat(m.length));

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

let baselineRenameMap = null;

function getBaselineRenameMap(baselineRef) {
  if (baselineRenameMap) return baselineRenameMap;
  baselineRenameMap = new Map();
  try {
    const output = execFileSync(
      'git',
      [
        '-c',
        'diff.renameLimit=0',
        'diff',
        '-M',
        '--name-status',
        '-z',
        '--diff-filter=R',
        '--end-of-options',
        baselineRef,
        '--',
        'src/content/posts/*.mdx',
      ],
      { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const fields = output.split('\0');
    for (let index = 0; index + 2 < fields.length; index += 3) {
      const status = fields[index];
      const oldPath = fields[index + 1];
      const newPath = fields[index + 2];
      if (status?.startsWith('R') && oldPath && newPath) {
        baselineRenameMap.set(newPath, oldPath);
      }
    }
  } catch {
    // No rename information available; fall back to same-path lookup only.
  }
  return baselineRenameMap;
}

function baselineFromRaw(raw, filePath) {
  const { violations } = checkText(raw, filePath);
  const keys = new Set(violations.map(violationKey));
  const wordCounts = new Map();
  for (const v of violations) {
    const word = v.word.toLowerCase();
    wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
  }
  return { keys, wordCounts };
}

function baselineRefExists(baselineRef) {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', baselineRef], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

function getBaselineViolations(filePath, baselineRef) {
  if (!baselineRef) return null;

  const repoRelative = path.relative(REPO_ROOT, path.resolve(filePath));
  const candidates = [repoRelative];
  // Renamed files keep their grandfathered baseline: resolve the pre-rename
  // path so a pure rename does not resurface pre-existing violations.
  const renamedFrom = getBaselineRenameMap(baselineRef).get(repoRelative);
  if (renamedFrom) candidates.push(renamedFrom);

  for (const fetchFirst of [false, true]) {
    for (const candidate of candidates) {
      try {
        if (fetchFirst) ensureRemoteBaselineRef(baselineRef);
        return baselineFromRaw(readBaselineFile(candidate, baselineRef), filePath);
      } catch {
        // Try the next candidate / fetch round.
      }
    }
  }
  // Either the file is new at baselineRef (correct: all its violations are
  // new) or baselineRef itself couldn't be resolved (e.g. no network to fetch
  // origin, or the ref genuinely doesn't exist) — in the latter case
  // grandfathered violations can't be suppressed and every historical
  // violation in the file will look "new". Warn so that flood doesn't get
  // mistaken for a real regression.
  if (!baselineRefExists(baselineRef)) {
    console.error(
      `[check-jingjing] Warning: baseline ref "${baselineRef}" could not be resolved ` +
        `(no network to fetch, or the ref doesn't exist) — historical/grandfathered ` +
        `violations in ${path.relative(REPO_ROOT, filePath)} cannot be suppressed and ` +
        `may appear as "new". Run 'git fetch origin' and retry before assuming a regression.`
    );
  }
  // New file or unavailable baseline: all violations are new.
  return null;
}

function filterBaselineViolations(violations, baseline) {
  if (!baseline) return violations;

  // Pass 1: exact context matches are grandfathered and consume their
  // word's baseline budget.
  const remainingCounts = new Map(baseline.wordCounts);
  const drifted = [];
  for (const v of violations) {
    if (baseline.keys.has(violationKey(v))) {
      const word = v.word.toLowerCase();
      remainingCounts.set(word, (remainingCounts.get(word) || 0) - 1);
    } else {
      drifted.push(v);
    }
  }

  // Pass 2: a violation whose surrounding context drifted (e.g. the sentence
  // was reworded around a pre-existing proper noun) stays grandfathered while
  // the word's total baseline count is not exceeded. A genuinely new
  // decorative word — or one more occurrence of an old one — always flags.
  return drifted.filter((v) => {
    const word = v.word.toLowerCase();
    const left = remainingCounts.get(word) || 0;
    if (left > 0) {
      remainingCounts.set(word, left - 1);
      return false;
    }
    return true;
  });
}

// ── Exports for tests ──────────────────────────────────────────────
export { isAllowed, maskContent, checkText, checkFile, filterBaselineViolations, violationKey };

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
    const baseline = getBaselineViolations(filePath, baselineRef);
    const newViolations = filterBaselineViolations(violations, baseline);
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
      `  2. If genuinely a canonical/reusable term, apply GU-LOG_WRITER_PROMPT.md's glossary creation standard, discuss the boundary with ShroomDog, then add to src/data/glossary.json with definition + moguNote.\n` +
      `  3. If proper noun (product/people/lab) misclassified, discuss with ShroomDog before adding to ALLOWLIST_RAW in scripts/check-jingjing.mjs.\n` +
      (baselineRef
        ? `\nNote: --baseline-ref=${baselineRef} was used, so only new violations are reported; historical grandfathered violations are ignored.\n`
        : '')
  );
  process.exit(1);
} // end CLI guard
