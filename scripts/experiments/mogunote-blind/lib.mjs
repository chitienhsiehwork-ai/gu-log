import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const CONTRACT_VERSION = 'gp-source-preservation/v1';
export const EXPERIMENT_SCHEMA_VERSION = 'gp-273-mogunote-blind/v1';
export const BOARD_SCHEMA_VERSION = 'gp-273-mogunote-board/v1';
export const RESULT_SCHEMA_VERSION = 'gp-273-mogunote-ranking/v1';

export const MODEL_SPECS = Object.freeze([
  { provider: 'codex', model: 'gpt-5.6-sol', harness: 'codex exec' },
  { provider: 'codex', model: 'gpt-5.6-terra', harness: 'codex exec' },
  { provider: 'codex', model: 'gpt-5.6-luna', harness: 'codex exec' },
  { provider: 'claude', model: 'claude-opus-5', harness: 'claude --print' },
  { provider: 'claude', model: 'claude-fable-5', harness: 'claude --print' },
  { provider: 'claude', model: 'claude-opus-4-5', harness: 'claude --print' },
  { provider: 'claude', model: 'claude-opus-4-6', harness: 'claude --print' },
  { provider: 'grok', model: 'grok-4.5', harness: 'grok --single' },
  { provider: 'grok', model: 'grok-4.6', harness: 'grok --single' },
]);

export const COMMENTARY_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    version: { type: 'string' },
    source_sha256: { type: 'string' },
    translation_sha256: { type: 'string' },
    candidates: {
      type: 'array',
      minItems: 0,
      maxItems: 1,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', minLength: 1 },
          anchor_text: { type: 'string', minLength: 1 },
          after_byte: { type: 'integer', minimum: 1 },
          commentary: { type: 'string', minLength: 1 },
        },
        required: ['id', 'anchor_text', 'after_byte', 'commentary'],
        additionalProperties: false,
      },
    },
  },
  required: ['version', 'source_sha256', 'translation_sha256', 'candidates'],
  additionalProperties: false,
});

const PROBE_SCHEMA = Object.freeze({
  type: 'object',
  properties: { available: { type: 'boolean', const: true } },
  required: ['available'],
  additionalProperties: false,
});

const CURRENT_SHARED_CONTRACT = `盲測共同 transport contract：candidates 只能有 0 或 1 筆；若沒有值得留下的 MoguNote，必須明確回傳空陣列。不得在輸出中自稱、暗示或描述你是哪個 model／provider。\n\n`;

const FORBIDDEN_CANDIDATE_SELF_IDENTIFICATION = [
  /\b(?:gpt|claude|grok|codex|anthropic|openai|xai)\b/i,
  /模型(?:版本|名稱|身分)?[：:]?/,
];

const PRIVATE_ROOT_PREFIX = '/private/tmp/gu-log-mogunote-blind.';
const MAIN_TIMEOUT_MS = 8 * 60 * 1000;
const PROBE_TIMEOUT_MS = 90 * 1000;

export function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function stableJSON(value) {
  if (Array.isArray(value)) return `[${value.map(stableJSON).join(',')}]`;
  if (value && typeof value === 'object') {
    const pairs = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJSON(value[key])}`);
    return `{${pairs.join(',')}}`;
  }
  return JSON.stringify(value);
}

async function writePrivateFile(filePath, content) {
  const tmp = `${filePath}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, content, { mode: 0o600, flag: 'wx' });
  await fs.rename(tmp, filePath);
  await fs.chmod(filePath, 0o600);
}

async function writePrivateJSON(filePath, value) {
  await writePrivateFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function makePrivateDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true, mode: 0o700 });
  await fs.chmod(dirPath, 0o700);
}

export function stripMoguNotes(post, { expectedCount } = {}) {
  const matches = [...post.matchAll(/\n<MoguNote(?:\s+[^>]*)?>\n[\s\S]*?\n<\/MoguNote>\n?/g)];
  if (expectedCount !== undefined && matches.length !== expectedCount) {
    throw new Error(`expected ${expectedCount} MoguNote block(s), found ${matches.length}`);
  }
  let frozen = post.replace(/\n<MoguNote(?:\s+[^>]*)?>\n[\s\S]*?\n<\/MoguNote>\n?/g, '\n');
  if (!frozen.includes('<MoguNote')) {
    frozen = frozen.replace(
      /\nimport MoguNote from ['"]\.\.\/\.\.\/components\/MoguNote\.astro['"];\n/,
      '\n'
    );
  }
  return frozen.replace(/\n{3,}$/g, '\n');
}

export function extractIncumbent(post) {
  const match = post.match(
    /\n<MoguNote(?:\s+summary=(?:"([^"]*)"|'([^']*)'))?[^>]*>\n([\s\S]*?)\n<\/MoguNote>/
  );
  if (!match || match.index === undefined) throw new Error('incumbent MoguNote not found');
  const before = post.slice(0, match.index).trimEnd();
  const anchorText = before.split(/\n\n/).at(-1)?.trim() ?? '';
  const summary = match[1] ?? match[2] ?? '';
  const commentary = match[3].trim();
  if (!anchorText || !commentary) throw new Error('incumbent MoguNote is incomplete');
  return { summary, commentary, anchorText };
}

export function renderPrompt(template, values) {
  const replacements = {
    '{{.Version}}': values.version,
    '{{.SourceSHA256}}': values.sourceSha256,
    '{{.TranslationSHA256}}': values.translationSha256,
    '{{.Source}}': values.source,
    '{{.Translation}}': values.translation,
  };
  let rendered = template;
  for (const [token, value] of Object.entries(replacements)) {
    rendered = rendered.split(token).join(value);
  }
  if (/{{\.[A-Za-z]+}}/.test(rendered)) throw new Error('prompt contains unresolved tokens');
  return rendered;
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} keys ${actual.join(',')} do not match ${wanted.join(',')}`);
  }
}

export function validateCommentaryArtifact(artifact, inputs) {
  assertPlainObject(artifact, 'artifact');
  assertExactKeys(
    artifact,
    ['version', 'source_sha256', 'translation_sha256', 'candidates'],
    'artifact'
  );
  if (artifact.version !== CONTRACT_VERSION) throw new Error('artifact version mismatch');
  if (
    artifact.source_sha256 !== inputs.sourceSha256 ||
    artifact.translation_sha256 !== inputs.translationSha256
  ) {
    throw new Error('artifact hashes are stale');
  }
  if (!Array.isArray(artifact.candidates)) throw new Error('candidates must be an explicit array');
  if (artifact.candidates.length > 1) throw new Error('candidates must contain at most one item');
  if (artifact.candidates.length === 0) return artifact;

  const candidate = artifact.candidates[0];
  assertPlainObject(candidate, 'candidate');
  assertExactKeys(candidate, ['id', 'anchor_text', 'after_byte', 'commentary'], 'candidate');
  for (const field of ['id', 'anchor_text', 'commentary']) {
    if (typeof candidate[field] !== 'string' || candidate[field].trim() === '') {
      throw new Error(`candidate ${field} must be non-empty text`);
    }
  }
  if (!Number.isInteger(candidate.after_byte) || candidate.after_byte <= 0) {
    throw new Error('candidate after_byte must be a positive integer');
  }
  if (candidate.commentary.includes('<MoguNote') || candidate.commentary.includes('</MoguNote>')) {
    throw new Error('candidate commentary contains component markup');
  }
  if (
    FORBIDDEN_CANDIDATE_SELF_IDENTIFICATION.some((pattern) => pattern.test(candidate.commentary))
  ) {
    throw new Error('candidate commentary leaks model or provider identity');
  }

  const translation = Buffer.from(inputs.translation);
  const anchor = Buffer.from(candidate.anchor_text);
  let bodyStart = 0;
  if (inputs.translation.startsWith('---\n')) {
    const frontmatterEnd = translation.indexOf(Buffer.from('\n---\n'), 4);
    if (frontmatterEnd >= 0) bodyStart = frontmatterEnd + Buffer.byteLength('\n---\n');
  }
  const start = candidate.after_byte - anchor.length;
  if (start < Math.max(0, bodyStart) || candidate.after_byte > translation.length) {
    throw new Error('candidate anchor is outside the translation body');
  }
  if (
    !translation.subarray(0, candidate.after_byte).toString('utf8').endsWith(candidate.anchor_text)
  ) {
    throw new Error('candidate anchor_text does not end at after_byte');
  }
  if (candidate.after_byte < translation.length) {
    const suffix = translation.subarray(candidate.after_byte).toString('utf8');
    if (!suffix.startsWith('\n\n')) throw new Error('candidate anchor is not a paragraph boundary');
  }
  return artifact;
}

function strictParse(text) {
  if (typeof text !== 'string') return text;
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    throw new Error('model response is not a bare JSON object');
  }
  return JSON.parse(trimmed);
}

export function unwrapStructuredOutput(raw) {
  const parsed = strictParse(raw);
  const queue = [parsed];
  const seen = new Set();
  while (queue.length > 0) {
    const value = queue.shift();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    if (
      !Array.isArray(value) &&
      Object.hasOwn(value, 'version') &&
      Object.hasOwn(value, 'candidates')
    ) {
      return value;
    }
    for (const key of [
      'structured_output',
      'structuredOutput',
      'result',
      'output',
      'content',
      'message',
    ]) {
      const child = value[key];
      if (typeof child === 'string') {
        try {
          queue.push(strictParse(child));
        } catch {
          // Wrapper narration is not accepted as a structured artifact.
        }
      } else if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === 'object' && typeof item.text === 'string') {
            try {
              queue.push(strictParse(item.text));
            } catch {
              // Keep looking for a known transport envelope.
            }
          } else {
            queue.push(item);
          }
        }
      } else {
        queue.push(child);
      }
    }
  }
  throw new Error('transport wrapper does not contain a commentary artifact');
}

function unwrapProbe(raw) {
  const parsed = strictParse(raw);
  const queue = [parsed];
  const seen = new Set();
  while (queue.length > 0) {
    const value = queue.shift();
    if (typeof value === 'string') {
      try {
        queue.push(strictParse(value));
      } catch {
        // Not a strict structured payload.
      }
      continue;
    }
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    if (!Array.isArray(value) && value.available === true) return value;
    for (const key of [
      'structured_output',
      'structuredOutput',
      'result',
      'output',
      'content',
      'message',
    ]) {
      const child = value[key];
      if (typeof child === 'string') {
        try {
          queue.push(strictParse(child));
        } catch {
          // Not a strict structured payload.
        }
      } else if (Array.isArray(child)) {
        for (const item of child) queue.push(item?.text ?? item);
      } else {
        queue.push(child);
      }
    }
  }
  throw new Error('probe did not return {"available":true}');
}

function buildInvocation(spec, { effort, runDir, schema, sessionId, outputPath }) {
  const schemaJSON = JSON.stringify(schema);
  if (spec.provider === 'codex') {
    return {
      command: 'codex',
      args: [
        'exec',
        '--json',
        '--ephemeral',
        '--ignore-user-config',
        '--skip-git-repo-check',
        '--sandbox',
        'read-only',
        '--cd',
        runDir,
        '--model',
        spec.model,
        '-c',
        `model_reasoning_effort=${JSON.stringify(effort)}`,
        '--output-schema',
        path.join(runDir, 'schema.json'),
        '--output-last-message',
        outputPath,
        '-',
      ],
      providerOutputPath: outputPath,
    };
  }
  if (spec.provider === 'claude') {
    return {
      command: 'claude',
      args: [
        '--print',
        '--model',
        spec.model,
        '--effort',
        effort,
        '--tools',
        '',
        '--no-session-persistence',
        '--session-id',
        sessionId,
        '--disable-slash-commands',
        '--safe-mode',
        '--no-chrome',
        '--output-format',
        'json',
        '--json-schema',
        schemaJSON,
      ],
    };
  }
  if (spec.provider === 'grok') {
    return {
      command: 'grok',
      args: [
        '--cwd',
        runDir,
        '--model',
        spec.model,
        '--reasoning-effort',
        effort,
        '--prompt-file',
        path.join(runDir, 'prompt.txt'),
        '--verbatim',
        '--json-schema',
        schemaJSON,
        '--output-format',
        'json',
        '--tools',
        '',
        '--no-memory',
        '--no-subagents',
        '--disable-web-search',
        '--permission-mode',
        'dontAsk',
        '--sandbox',
        'read-only',
        '--max-turns',
        '1',
        '--session-id',
        sessionId,
      ],
    };
  }
  throw new Error(`unsupported provider ${spec.provider}`);
}

async function spawnCaptured(command, args, { cwd, stdin, timeoutMs }) {
  return await new Promise((resolve) => {
    const startedAt = new Date();
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, CI: '1', NO_COLOR: '1', TERM: 'dumb' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    let timedOut = false;
    let spawnError;
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (error) => {
      spawnError = error;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000).unref();
    }, timeoutMs);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({
        code,
        signal,
        timedOut,
        spawnError: spawnError?.message,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
      });
    });
    child.stdin.end(stdin);
  });
}

function narrowFailureClass(result) {
  if (result.timedOut) return 'TIMEOUT';
  if (result.spawnError) return 'SPAWN_ERROR';
  if (result.code === 0) return undefined;
  const error = result.stderr.toLowerCase();
  if (/model[^\n]{0,100}(not found|not available|unsupported|does not exist)/.test(error)) {
    return 'MODEL_UNAVAILABLE';
  }
  if (/rate[_ -]?limit|usage limit|weekly limit|credit balance|quota exceeded/.test(error)) {
    return 'QUOTA_OR_RATE_LIMIT';
  }
  if (/unauthorized|authentication|not logged in|invalid api key/.test(error)) return 'AUTH';
  return 'TRANSPORT';
}

function parseJSONIfPossible(value) {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function extractTransportProvenance(spec, rawOutput, transportOutput = '') {
  if (spec.provider === 'codex') {
    const started = transportOutput
      .split('\n')
      .map(parseJSONIfPossible)
      .find((event) => event?.type === 'thread.started');
    return {
      actualModel: spec.model,
      providerReportedModels: [spec.model],
      providerSessionId: started?.thread_id ?? null,
    };
  }
  const wrapper = parseJSONIfPossible(rawOutput);
  if (!wrapper || typeof wrapper !== 'object') {
    return { actualModel: null, providerReportedModels: [], providerSessionId: null };
  }
  const usage =
    wrapper.modelUsage && typeof wrapper.modelUsage === 'object' ? wrapper.modelUsage : {};
  if (spec.provider === 'claude') {
    const reported = Object.entries(usage).map(
      ([key, value]) => value?.canonicalModel ?? value?.canonical_model ?? key
    );
    return {
      actualModel: reported.find((model) => model === spec.model) ?? null,
      providerReportedModels: reported,
      providerSessionId: wrapper.session_id ?? null,
    };
  }
  const reported = Object.keys(usage);
  return {
    actualModel:
      reported.find((model) => model === spec.model || model.startsWith(`${spec.model}-`)) ?? null,
    providerReportedModels: reported,
    providerSessionId: wrapper.sessionId ?? null,
  };
}

async function createInvocationDir(root, kind) {
  const uuid = crypto.randomUUID();
  const base = path.join(root, kind);
  const runDir = path.join(base, uuid);
  await makePrivateDir(runDir);
  return { uuid, runDir };
}

async function runOneInvocation({
  root,
  kind,
  spec,
  arm,
  effort,
  prompt,
  schema,
  attempt,
  timeoutMs,
}) {
  const { uuid, runDir } = await createInvocationDir(root, kind);
  const sessionId = crypto.randomUUID();
  const outputPath = path.join(runDir, 'provider-response.json');
  await writePrivateFile(path.join(runDir, 'prompt.txt'), prompt);
  await writePrivateJSON(path.join(runDir, 'schema.json'), schema);
  const promptHash = sha256(prompt);
  const schemaHash = sha256(`${JSON.stringify(schema, null, 2)}\n`);
  const initialManifest = {
    schema_version: EXPERIMENT_SCHEMA_VERSION,
    run_uuid: uuid,
    cwd_realpath: await fs.realpath(runDir),
    requested_model: spec.model,
    actual_model: null,
    provider: spec.provider,
    harness: spec.harness,
    effort,
    arm,
    isolation_session_id: sessionId,
    prompt_sha256: promptHash,
    schema_sha256: schemaHash,
    attempt,
    timeout_ms: timeoutMs,
    format_retry: attempt > 1,
    status: 'RUNNING',
  };
  await writePrivateJSON(path.join(runDir, 'manifest.json'), initialManifest);

  const invocation = buildInvocation(spec, { effort, runDir, schema, sessionId, outputPath });
  const result = await spawnCaptured(invocation.command, invocation.args, {
    cwd: runDir,
    stdin: prompt,
    timeoutMs,
  });
  let rawOutput = result.stdout;
  if (invocation.providerOutputPath) {
    try {
      rawOutput = await fs.readFile(invocation.providerOutputPath, 'utf8');
    } catch {
      // Preserve transport stdout when Codex did not write a final response.
    }
    await writePrivateFile(path.join(runDir, 'transport.jsonl'), result.stdout);
  }
  await writePrivateFile(path.join(runDir, 'stdout.json'), rawOutput);
  await writePrivateFile(path.join(runDir, 'stderr.log'), result.stderr);

  const failureClass = narrowFailureClass(result);
  const transportProvenance = extractTransportProvenance(spec, rawOutput, result.stdout);
  const finalManifest = {
    ...initialManifest,
    actual_model: result.code === 0 ? transportProvenance.actualModel : null,
    provider_reported_models: transportProvenance.providerReportedModels,
    provider_session_id: transportProvenance.providerSessionId,
    process_started_at: result.startedAt,
    process_finished_at: result.finishedAt,
    exit_status: result.code,
    signal: result.signal,
    timed_out: result.timedOut,
    raw_output_sha256: sha256(rawOutput),
    stderr_sha256: sha256(result.stderr),
    failure_class: failureClass ?? null,
    status: result.code === 0 ? 'RETURNED' : failureClass,
  };
  await writePrivateJSON(path.join(runDir, 'manifest.json'), finalManifest);
  return { uuid, runDir, sessionId, result, rawOutput, manifest: finalManifest };
}

export async function initializeExperiment({ repoRoot, root } = {}) {
  const resolvedRepo = path.resolve(repoRoot ?? process.cwd());
  const experimentRoot = root
    ? path.resolve(root)
    : await fs.mkdtemp(PRIVATE_ROOT_PREFIX, { encoding: 'utf8' });
  await makePrivateDir(experimentRoot);
  const realRoot = await fs.realpath(experimentRoot);
  if (!realRoot.startsWith(PRIVATE_ROOT_PREFIX)) {
    throw new Error(`experiment root must be under ${PRIVATE_ROOT_PREFIX}*`);
  }
  for (const name of ['inputs', 'probes', 'runs', 'collector']) {
    await makePrivateDir(path.join(realRoot, name));
  }

  const sourcePath = path.join(
    resolvedRepo,
    'tools/gp-pipeline/internal/preservation/testdata/gp-273/source.txt'
  );
  const postPath = path.join(
    resolvedRepo,
    'src/content/posts/gp-273-20260813-brentfitzgerald-human-is-the-loop.mdx'
  );
  const currentTemplatePath = path.join(
    resolvedRepo,
    'tools/gp-pipeline/internal/prompts/commentary.tmpl'
  );
  const revisedTemplatePath = path.join(
    resolvedRepo,
    'scripts/experiments/mogunote-blind/revised-commentary.tmpl'
  );
  const [source, post, currentTemplate, revisedTemplate] = await Promise.all([
    fs.readFile(sourcePath, 'utf8'),
    fs.readFile(postPath, 'utf8'),
    fs.readFile(currentTemplatePath, 'utf8'),
    fs.readFile(revisedTemplatePath, 'utf8'),
  ]);
  const translation = stripMoguNotes(post, { expectedCount: 1 });
  const incumbent = extractIncumbent(post);
  const values = {
    version: CONTRACT_VERSION,
    sourceSha256: sha256(source),
    translationSha256: sha256(translation),
    source,
    translation,
  };
  const currentPrompt = renderPrompt(`${CURRENT_SHARED_CONTRACT}${currentTemplate}`, values);
  const revisedPrompt = renderPrompt(revisedTemplate, values);
  const schemaText = `${JSON.stringify(COMMENTARY_SCHEMA, null, 2)}\n`;
  const inputsDir = path.join(realRoot, 'inputs');
  await Promise.all([
    writePrivateFile(path.join(inputsDir, 'source.txt'), source),
    writePrivateFile(path.join(inputsDir, 'translation.mdx'), translation),
    writePrivateFile(path.join(inputsDir, 'current-prompt.txt'), currentPrompt),
    writePrivateFile(path.join(inputsDir, 'revised-prompt.txt'), revisedPrompt),
    writePrivateFile(path.join(inputsDir, 'schema.json'), schemaText),
    writePrivateJSON(path.join(inputsDir, 'incumbent.json'), incumbent),
  ]);
  const inputManifest = {
    schema_version: EXPERIMENT_SCHEMA_VERSION,
    experiment_id: `gp-273-${crypto.randomBytes(8).toString('hex')}`,
    created_at: new Date().toISOString(),
    repo_head: null,
    inputs: {
      source: { file: 'source.txt', sha256: values.sourceSha256 },
      translation: { file: 'translation.mdx', sha256: values.translationSha256 },
      current_prompt: { file: 'current-prompt.txt', sha256: sha256(currentPrompt) },
      revised_prompt: { file: 'revised-prompt.txt', sha256: sha256(revisedPrompt) },
      schema: { file: 'schema.json', sha256: sha256(schemaText) },
      incumbent: {
        file: 'incumbent.json',
        sha256: sha256(`${JSON.stringify(incumbent, null, 2)}\n`),
      },
    },
  };
  await writePrivateJSON(path.join(inputsDir, 'manifest.json'), inputManifest);
  return { root: realRoot, inputManifest };
}

async function readInputs(root) {
  const inputsDir = path.join(root, 'inputs');
  const [
    source,
    translation,
    currentPrompt,
    revisedPrompt,
    schemaText,
    incumbentText,
    manifestText,
  ] = await Promise.all([
    fs.readFile(path.join(inputsDir, 'source.txt'), 'utf8'),
    fs.readFile(path.join(inputsDir, 'translation.mdx'), 'utf8'),
    fs.readFile(path.join(inputsDir, 'current-prompt.txt'), 'utf8'),
    fs.readFile(path.join(inputsDir, 'revised-prompt.txt'), 'utf8'),
    fs.readFile(path.join(inputsDir, 'schema.json'), 'utf8'),
    fs.readFile(path.join(inputsDir, 'incumbent.json'), 'utf8'),
    fs.readFile(path.join(inputsDir, 'manifest.json'), 'utf8'),
  ]);
  const manifest = JSON.parse(manifestText);
  const expected = manifest.inputs;
  for (const [name, content] of Object.entries({
    source,
    translation,
    current_prompt: currentPrompt,
    revised_prompt: revisedPrompt,
    schema: schemaText,
    incumbent: incumbentText,
  })) {
    if (sha256(content) !== expected[name].sha256) throw new Error(`stale ${name} input hash`);
  }
  return {
    source,
    translation,
    currentPrompt,
    revisedPrompt,
    schema: JSON.parse(schemaText),
    incumbent: JSON.parse(incumbentText),
    manifest,
    sourceSha256: sha256(source),
    translationSha256: sha256(translation),
  };
}

export async function probeModel(root, spec) {
  const prompt =
    'Availability probe only. Do not use tools or read files. Return exactly the JSON object {"available":true}.';
  const invocation = await runOneInvocation({
    root,
    kind: 'probes',
    spec,
    arm: 'probe',
    effort: 'low',
    prompt,
    schema: PROBE_SCHEMA,
    attempt: 1,
    timeoutMs: PROBE_TIMEOUT_MS,
  });
  let status = invocation.result.code === 0 ? 'AVAILABLE' : 'UNAVAILABLE';
  let validationError;
  if (status === 'AVAILABLE') {
    try {
      unwrapProbe(invocation.rawOutput);
      if (!invocation.manifest.actual_model) {
        throw new Error('provider provenance does not confirm the requested model');
      }
    } catch (error) {
      status = 'UNAVAILABLE';
      validationError = error.message;
    }
  }
  const probeManifestPath = path.join(invocation.runDir, 'manifest.json');
  const probeManifest = JSON.parse(await fs.readFile(probeManifestPath, 'utf8'));
  await writePrivateJSON(probeManifestPath, {
    ...probeManifest,
    validation_status: status,
    validation_error: validationError ?? null,
  });
  const summary = {
    requested_model: spec.model,
    actual_model: status === 'AVAILABLE' ? invocation.manifest.actual_model : null,
    provider_reported_models: invocation.manifest.provider_reported_models,
    provider: spec.provider,
    harness: spec.harness,
    status,
    run_uuid: invocation.uuid,
    validation_error: validationError ?? null,
    failure_class: invocation.manifest.failure_class,
  };
  await writePrivateJSON(path.join(invocation.runDir, 'probe-result.json'), summary);
  return summary;
}

function formatRetryPrompt(prompt, rawOutput, error) {
  const previous = rawOutput.trim().slice(0, 20_000);
  return `${prompt}\n\nFORMAT-ONLY RETRY：上一個 response 未通過 machine contract（${error}）。不得改寫、改善或另挑內容；若上一個 response 有可辨識的 candidate，請保留其 commentary 與 anchor 原意，只修正 bare JSON、required fields、hash、0/1 cardinality 或 byte boundary。若沒有可保留的 candidate，回傳同一 envelope 的空 candidates。\n\n上一個 response：\n${previous}`;
}

export async function runCell(root, spec, arm) {
  const inputs = await readInputs(root);
  const basePrompt = arm === 'current' ? inputs.currentPrompt : inputs.revisedPrompt;
  const attempts = [];
  let prompt = basePrompt;
  let finalArtifact;
  let finalActualModel;
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const invocation = await runOneInvocation({
      root,
      kind: 'runs',
      spec,
      arm,
      effort: 'high',
      prompt,
      schema: inputs.schema,
      attempt,
      timeoutMs: MAIN_TIMEOUT_MS,
    });
    let validationError;
    if (invocation.result.code === 0) {
      try {
        const artifact = unwrapStructuredOutput(invocation.rawOutput);
        const validatedArtifact = validateCommentaryArtifact(artifact, inputs);
        if (!invocation.manifest.actual_model) {
          throw new Error('provider provenance does not confirm the requested model');
        }
        finalArtifact = validatedArtifact;
        finalActualModel = invocation.manifest.actual_model;
        await writePrivateJSON(path.join(invocation.runDir, 'candidate.json'), finalArtifact);
      } catch (error) {
        validationError = error.message;
      }
    } else {
      validationError = invocation.manifest.failure_class ?? 'transport failure';
    }
    attempts.push({
      run_uuid: invocation.uuid,
      cwd: invocation.runDir,
      isolation_session_id: invocation.sessionId,
      provider_session_id: invocation.manifest.provider_session_id,
      actual_model: invocation.manifest.actual_model,
      provider_reported_models: invocation.manifest.provider_reported_models,
      exit_status: invocation.result.code,
      prompt_sha256: invocation.manifest.prompt_sha256,
      raw_output_sha256: invocation.manifest.raw_output_sha256,
      validation_error: validationError ?? null,
      format_retry: attempt > 1,
    });
    const manifestPath = path.join(invocation.runDir, 'manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    await writePrivateJSON(manifestPath, {
      ...manifest,
      source_sha256: inputs.sourceSha256,
      translation_sha256: inputs.translationSha256,
      base_prompt_sha256: inputs.manifest.inputs[`${arm}_prompt`].sha256,
      validation_status: validationError ? 'INVALID' : 'VALID',
      validation_error: validationError ?? null,
      candidate_sha256: finalArtifact ? sha256(stableJSON(finalArtifact)) : null,
    });
    if (finalArtifact) break;
    lastError = validationError;
    if (attempt === 1)
      prompt = formatRetryPrompt(basePrompt, invocation.rawOutput, validationError);
  }
  const cell = {
    schema_version: EXPERIMENT_SCHEMA_VERSION,
    requested_model: spec.model,
    actual_model: finalArtifact ? finalActualModel : null,
    provider: spec.provider,
    harness: spec.harness,
    effort: 'high',
    arm,
    source_sha256: inputs.sourceSha256,
    translation_sha256: inputs.translationSha256,
    schema_sha256: inputs.manifest.inputs.schema.sha256,
    base_prompt_sha256: inputs.manifest.inputs[`${arm}_prompt`].sha256,
    status: finalArtifact ? 'VALID' : 'INVALID_OUTPUT',
    attempts,
    artifact: finalArtifact ?? null,
    final_error: finalArtifact ? null : (lastError ?? null),
  };
  return cell;
}

async function mapWithConcurrency(items, concurrency, fn, onProgress) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
      onProgress?.(results[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function executeExperiment(root, { concurrency = 3, onProgress } = {}) {
  const resolvedRoot = await fs.realpath(root);
  const probes = await mapWithConcurrency(
    MODEL_SPECS,
    concurrency,
    (spec) => probeModel(resolvedRoot, spec),
    (result) => onProgress?.({ phase: 'probe', result })
  );
  await writePrivateJSON(path.join(resolvedRoot, 'collector', 'probes.json'), probes);
  const available = MODEL_SPECS.filter(
    (spec) => probes.find((probe) => probe.requested_model === spec.model)?.status === 'AVAILABLE'
  );
  const jobs = available.flatMap((spec) => [
    { spec, arm: 'current' },
    { spec, arm: 'revised' },
  ]);
  const randomizedJobs = shuffle(jobs);
  const cells = await mapWithConcurrency(
    randomizedJobs,
    concurrency,
    ({ spec, arm }) => runCell(resolvedRoot, spec, arm),
    (result) => onProgress?.({ phase: 'cell', result })
  );
  await writePrivateJSON(path.join(resolvedRoot, 'collector', 'cells.private.json'), cells);
  const packet = await buildBlindPacket(resolvedRoot, cells);
  await writePrivateJSON(
    path.join(resolvedRoot, 'collector', 'mapping.private.json'),
    packet.mapping
  );
  await writePrivateJSON(
    path.join(resolvedRoot, 'collector', 'blind-packet.json'),
    packet.publicPacket
  );
  const summary = {
    schema_version: EXPERIMENT_SCHEMA_VERSION,
    experiment_id: packet.publicPacket.experiment_id,
    completed_at: new Date().toISOString(),
    probes: probes.map(({ requested_model, provider, status, failure_class }) => ({
      requested_model,
      provider,
      status,
      failure_class,
    })),
    paired_models: packet.pairedModels,
    candidate_count: packet.publicPacket.entries.length,
  };
  await writePrivateJSON(path.join(resolvedRoot, 'collector', 'summary.json'), summary);
  return summary;
}

function paragraphContext(translation, afterByte) {
  const beforeBytes = Buffer.from(translation).subarray(0, afterByte);
  const afterBytes = Buffer.from(translation).subarray(afterByte);
  const beforeText = beforeBytes.toString('utf8').trimEnd();
  const afterText = afterBytes.toString('utf8').replace(/^\s+/, '');
  const before = beforeText.split(/\n\n/).at(-1)?.trim() ?? '';
  const after = afterText.split(/\n\n/)[0]?.trim() ?? '';
  return { before, after };
}

function findIncumbentContext(translation, incumbent) {
  const offset = Buffer.from(translation).indexOf(Buffer.from(incumbent.anchorText));
  if (offset < 0) throw new Error('incumbent anchor not found in frozen translation');
  return paragraphContext(translation, offset + Buffer.byteLength(incumbent.anchorText));
}

function shuffle(values) {
  const out = [...values];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const other = crypto.randomInt(index + 1);
    [out[index], out[other]] = [out[other], out[index]];
  }
  return out;
}

async function buildBlindPacket(root, cells) {
  const inputs = await readInputs(root);
  const pairedModels = MODEL_SPECS.filter((spec) => {
    const pair = cells.filter((cell) => cell.requested_model === spec.model);
    return pair.length === 2 && pair.every((cell) => cell.status === 'VALID');
  }).map((spec) => spec.model);
  const entries = [];
  const cellMappings = [];
  for (const cell of cells) {
    if (!pairedModels.includes(cell.requested_model)) continue;
    const candidate = cell.artifact.candidates[0];
    const privateCell = {
      requested_model: cell.requested_model,
      actual_model: cell.actual_model,
      provider: cell.provider,
      arm: cell.arm,
      type: candidate ? 'candidate' : 'abstain',
      run_uuid: cell.attempts.at(-1).run_uuid,
      isolation_session_id: cell.attempts.at(-1).isolation_session_id,
      provider_session_id: cell.attempts.at(-1).provider_session_id,
      candidate_sha256: sha256(stableJSON(cell.artifact)),
    };
    if (!candidate) {
      cellMappings.push({ ...privateCell, publicRef: 'no-note' });
      continue;
    }
    const context = paragraphContext(inputs.translation, candidate.after_byte);
    const entryRef = `candidate-${cellMappings.length + 1}`;
    entries.push({
      entryRef,
      private: { type: 'candidate', candidate_sha256: privateCell.candidate_sha256 },
      public: {
        before: context.before,
        after: context.after,
        summary: '',
        note: candidate.commentary,
        empty: false,
      },
    });
    cellMappings.push({ ...privateCell, publicRef: entryRef });
  }
  const incumbentContext = findIncumbentContext(inputs.translation, inputs.incumbent);
  entries.push({
    entryRef: 'incumbent',
    private: { type: 'incumbent', candidate_sha256: sha256(stableJSON(inputs.incumbent)) },
    public: {
      before: incumbentContext.before,
      after: incumbentContext.after,
      summary: inputs.incumbent.summary,
      note: inputs.incumbent.commentary,
      empty: false,
    },
  });
  entries.push({
    entryRef: 'no-note',
    private: { type: 'no-note', candidate_sha256: sha256('no-note') },
    public: {
      before: incumbentContext.before,
      after: incumbentContext.after,
      summary: '',
      note: '',
      empty: true,
    },
  });
  const ordered = shuffle(entries).map((entry, index) => ({
    ...entry,
    blindId: `N${String(index + 1).padStart(2, '0')}`,
  }));
  const experimentId = inputs.manifest.experiment_id;
  const publicCore = {
    schema_version: BOARD_SCHEMA_VERSION,
    experiment_id: experimentId,
    title: 'GP-273 MoguNote 匿名評選',
    entries: ordered.map(({ blindId, public: value }) => ({ id: blindId, ...value })),
  };
  const boardHash = sha256(stableJSON(publicCore));
  const idByRef = new Map(ordered.map((entry) => [entry.entryRef, entry.blindId]));
  return {
    pairedModels,
    mapping: {
      schema_version: EXPERIMENT_SCHEMA_VERSION,
      experiment_id: experimentId,
      board_sha256: boardHash,
      entries: ordered.map(({ blindId, private: value }) => ({ id: blindId, ...value })),
      cells: cellMappings.map(({ publicRef, ...cell }) => ({
        ...cell,
        id: idByRef.get(publicRef),
      })),
    },
    publicPacket: { ...publicCore, board_sha256: boardHash },
  };
}

export async function rebuildBlindPacket(root) {
  const resolvedRoot = await fs.realpath(root);
  const cells = JSON.parse(
    await fs.readFile(path.join(resolvedRoot, 'collector', 'cells.private.json'), 'utf8')
  );
  const packet = await buildBlindPacket(resolvedRoot, cells);
  await Promise.all([
    writePrivateJSON(path.join(resolvedRoot, 'collector', 'mapping.private.json'), packet.mapping),
    writePrivateJSON(
      path.join(resolvedRoot, 'collector', 'blind-packet.json'),
      packet.publicPacket
    ),
  ]);
  const summaryPath = path.join(resolvedRoot, 'collector', 'summary.json');
  const summary = JSON.parse(await fs.readFile(summaryPath, 'utf8'));
  summary.paired_models = packet.pairedModels;
  summary.logical_output_count = packet.pairedModels.length * 2 + 2;
  summary.presented_entry_count = packet.publicPacket.entries.length;
  summary.candidate_count = packet.publicPacket.entries.length;
  summary.no_note_outputs_collapsed =
    packet.mapping.cells.filter((cell) => cell.type === 'abstain').length + 1;
  await writePrivateJSON(summaryPath, summary);
  return {
    experimentId: packet.publicPacket.experiment_id,
    boardSha256: packet.publicPacket.board_sha256,
    pairedModels: packet.pairedModels.length,
    logicalOutputs: summary.logical_output_count,
    presentedEntries: summary.presented_entry_count,
    noNoteOutputsCollapsed: summary.no_note_outputs_collapsed,
  };
}

function escapeInlineJSON(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e');
}

export function renderBoardHTML(packet) {
  const payload = escapeInlineJSON(packet);
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:,">
<title>${packet.title}</title>
<style>
:root{color-scheme:light dark;--bg:#f4f1e9;--paper:#fffdf7;--ink:#20201d;--muted:#68665f;--placeholder:#68665f;--line:#d8d1c2;--accent:#235c4d;--accent2:#d7eadf;--primary-ink:#fff;--danger:#8f3b32;--shadow:0 8px 30px #312b1d18;font-family:ui-rounded,"SF Pro Rounded","PingFang TC",system-ui,sans-serif}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);line-height:1.65}button,textarea{font:inherit}button{cursor:pointer}.shell{max-width:1180px;margin:auto;padding:20px}.top{position:sticky;top:0;z-index:10;background:#f4f1e9ee;backdrop-filter:blur(12px);border-bottom:1px solid var(--line);padding:14px 0}.topin{max-width:1180px;margin:auto;padding:0 20px;display:flex;gap:14px;align-items:center;justify-content:space-between}.top h1{font-size:clamp(1.15rem,3vw,1.65rem);margin:0}.top p{margin:2px 0 0;color:var(--muted);font-size:.92rem}.actions{display:flex;gap:8px;flex-wrap:wrap}.btn{min-height:44px;border:1px solid var(--line);background:var(--paper);color:var(--ink);border-radius:10px;padding:8px 12px}.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--primary-ink)}.btn.danger{color:var(--danger)}.btn:hover,.choice:hover{border-color:var(--accent)}.layout{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:20px;align-items:start}.cards{display:grid;gap:16px}.card{background:var(--paper);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);padding:18px}.card:focus-within{outline:3px solid #4c9b8066;outline-offset:2px}.cardhead{display:flex;align-items:center;justify-content:space-between;gap:12px}.id{font-weight:800;letter-spacing:.06em}.status{display:flex;gap:5px}.choice{min-width:44px;min-height:44px;border:1px solid var(--line);background:transparent;border-radius:999px;padding:8px 10px}.choice[aria-checked="true"]{background:var(--accent2);border-color:var(--accent);color:#123d31;font-weight:700}.context{margin:14px 0;padding:12px 14px;border-left:3px solid var(--line);color:var(--muted);font-size:.92rem}.context p{margin:0}.context p+p{margin-top:8px}.note{font-size:1.08rem;margin:16px 0;white-space:pre-wrap}.summary{font-weight:800;margin-bottom:7px}.empty{color:var(--muted);font-style:italic}.comment{width:100%;min-height:88px;resize:vertical;border:1px solid var(--line);border-radius:10px;background:transparent;color:var(--ink);padding:10px}.comment::placeholder{color:var(--placeholder);opacity:1}.rank{position:sticky;top:104px;background:var(--paper);border:1px solid var(--line);border-radius:16px;padding:16px;box-shadow:var(--shadow)}.rank h2{font-size:1rem;margin:0}.progress{display:block;color:var(--accent);font-weight:700;margin:2px 0 4px}.rank .hint{font-size:.85rem;color:var(--muted);margin:0 0 12px}.ranklist{display:grid;gap:8px}.rankitem{display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center;border:1px solid var(--line);border-radius:10px;padding:8px;background:var(--paper)}.rankitem[draggable="true"]{cursor:grab}.ranknum{width:1.6em;height:1.6em;border-radius:50%;display:grid;place-items:center;background:var(--accent);color:var(--primary-ink);font-size:.8rem}.move{display:flex;gap:3px}.move button{min-width:44px;min-height:44px;border:0;background:transparent;padding:5px}.emptyrank{color:var(--muted);font-size:.9rem}.notice{min-height:1.5em;color:var(--accent);font-size:.88rem;margin-top:10px}.privacy{margin:16px 0;color:var(--muted);font-size:.9rem}.footer{padding:24px 0;color:var(--muted);font-size:.86rem}
@media(prefers-color-scheme:dark){:root{--bg:#171816;--paper:#22231f;--ink:#f1eee5;--muted:#bbb5a7;--placeholder:#bbb5a7;--line:#44443d;--accent:#67b99b;--accent2:#254a3d;--primary-ink:#171816;--danger:#ef9a8f;--shadow:none}.top{background:#171816ee}.choice[aria-checked="true"]{color:#e9fff7}}
@media(max-width:820px){.layout{grid-template-columns:1fr}.rank{position:sticky;top:0;z-index:5;order:-1;max-height:32vh;overflow:auto}.top{position:static}.topin{align-items:flex-start;flex-direction:column}.actions{width:100%}.actions .btn{flex:1}.shell{padding:14px}.card{padding:15px}.status{flex-wrap:wrap;justify-content:flex-end}}
@media(prefers-reduced-motion:no-preference){.card,.rankitem{transition:border-color .15s,transform .15s}}
:focus-visible{outline:3px solid #4c9b80;outline-offset:2px}
</style>
</head>
<body>
<header class="top"><div class="topin"><div><h1>${packet.title}</h1><p>先憑味道選，不猜作者。你的判斷才是最後決定。</p></div><div class="actions"><button class="btn" id="copy">複製 JSON</button><button class="btn primary" id="download">下載 JSON</button><button class="btn danger" id="reset">重設</button></div></div></header>
<main class="shell"><p class="privacy">所有評語只保存在這台瀏覽器，直到你複製或下載。請先替每則標「留／待定／淘汰」，再排序「留」的候選；每張卡都可以自由寫評論。</p><div class="layout"><section class="cards" id="cards" aria-label="匿名候選"></section><aside class="rank"><h2>入圍排序</h2><span class="progress" id="progress">0/${packet.entries.length} 已評</span><p class="hint">拖曳，或用上移／下移按鈕。第一名放最上面。</p><div class="ranklist" id="ranklist"></div><div class="notice" id="notice" aria-live="polite"></div></aside></div><footer class="footer">匯出的 JSON 會綁定這一版評選板；如果候選內容變了，揭盅工具會拒絕舊結果。</footer></main>
<script>
const DATA=${payload};
const STORAGE_KEY='mogunote-blind:'+DATA.board_sha256;
const ids=DATA.entries.map(x=>x.id);
const blank=()=>({schema_version:'${RESULT_SCHEMA_VERSION}',experiment_id:DATA.experiment_id,board_sha256:DATA.board_sha256,submitted_at:null,ranking:[],decisions:Object.fromEntries(ids.map(id=>[id,'unreviewed'])),comments:Object.fromEntries(ids.map(id=>[id,'']))});
let state=load();
function valid(s){return s&&s.schema_version==='${RESULT_SCHEMA_VERSION}'&&s.experiment_id===DATA.experiment_id&&s.board_sha256===DATA.board_sha256&&Array.isArray(s.ranking)&&ids.every(id=>typeof s.decisions?.[id]==='string'&&typeof s.comments?.[id]==='string')&&s.ranking.every(id=>ids.includes(id))&&new Set(s.ranking).size===s.ranking.length}
function load(){const raw=localStorage.getItem(STORAGE_KEY);if(!raw)return blank();try{const parsed=JSON.parse(raw);if(valid(parsed))return parsed;document.addEventListener('DOMContentLoaded',()=>notice('舊的本機資料與這版評選板不相容，已保留原 bytes，未覆寫。'));return blank()}catch{document.addEventListener('DOMContentLoaded',()=>notice('本機資料損壞，已保留原 bytes，未覆寫。'));return blank()}}
function save(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state))}catch{notice('無法自動儲存；請立刻下載 JSON，避免評語遺失。')}}
function notice(msg){document.getElementById('notice').textContent=msg}
function esc(s){return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function render(){const cards=document.getElementById('cards');cards.innerHTML=DATA.entries.map(item=>'<article class="card" data-id="'+item.id+'"><div class="cardhead"><span class="id">'+item.id+'</span><div class="status" role="radiogroup" aria-label="'+item.id+' 判定">'+['keep','pending','reject'].map((value,i)=>'<button class="choice" role="radio" data-value="'+value+'" aria-checked="'+(state.decisions[item.id]===value)+'" tabindex="'+((state.decisions[item.id]===value||(state.decisions[item.id]==='unreviewed'&&i===0))?'0':'-1')+'">'+['留','待定','淘汰'][i]+'</button>').join('')+'</div></div><div class="context"><p>'+esc(item.before)+'</p>'+(item.after?'<p>接著：'+esc(item.after)+'</p>':'')+'</div><div class="note '+(item.empty?'empty':'')+'">'+(item.summary?'<div class="summary">'+esc(item.summary)+'</div>':'')+(item.empty?'（不放 MoguNote）':esc(item.note))+'</div><label for="c-'+item.id+'">你的評論</label><textarea class="comment" id="c-'+item.id+'" placeholder="好笑在哪裡、蠢在哪裡、你會怎麼修……">'+esc(state.comments[item.id])+'</textarea></article>').join('');
 cards.querySelectorAll('.card').forEach(card=>{const id=card.dataset.id,buttons=[...card.querySelectorAll('.choice')];buttons.forEach((btn,index)=>{btn.addEventListener('click',()=>choose(id,btn.dataset.value,true));btn.addEventListener('keydown',event=>{const delta=['ArrowRight','ArrowDown'].includes(event.key)?1:['ArrowLeft','ArrowUp'].includes(event.key)?-1:0;if(!delta)return;event.preventDefault();const next=(index+delta+buttons.length)%buttons.length;choose(id,buttons[next].dataset.value,true)})});card.querySelector('.comment').addEventListener('input',e=>{state.comments[id]=e.target.value;save()})});renderRank()}
function choose(id,value,focus){state.decisions[id]=value;if(value==='keep'&&!state.ranking.includes(id))state.ranking.push(id);if(value!=='keep')state.ranking=state.ranking.filter(x=>x!==id);save();render();if(focus)document.querySelector('article[data-id="'+id+'"] .choice[data-value="'+value+'"]').focus()}
function renderRank(){const list=document.getElementById('ranklist'),reviewed=ids.filter(id=>state.decisions[id]!=='unreviewed').length;document.getElementById('progress').textContent=reviewed+'/'+ids.length+' 已評';const keep=ids.filter(id=>state.decisions[id]==='keep');state.ranking=state.ranking.filter(id=>keep.includes(id));for(const id of keep)if(!state.ranking.includes(id))state.ranking.push(id);if(!state.ranking.length){list.innerHTML='<p class="emptyrank">把候選標成「留」，就會出現在這裡。</p>';return}list.innerHTML=state.ranking.map((id,index)=>'<div class="rankitem" draggable="true" data-id="'+id+'"><span class="ranknum">'+(index+1)+'</span><strong>'+id+'</strong><span class="move"><button data-dir="-1" aria-label="'+id+' 上移">↑</button><button data-dir="1" aria-label="'+id+' 下移">↓</button></span></div>').join('');let dragged;list.querySelectorAll('.rankitem').forEach(row=>{row.addEventListener('dragstart',()=>{dragged=row.dataset.id});row.addEventListener('dragover',e=>e.preventDefault());row.addEventListener('drop',()=>moveBefore(dragged,row.dataset.id));row.querySelectorAll('button').forEach(btn=>btn.addEventListener('click',()=>moveBy(row.dataset.id,Number(btn.dataset.dir))))})}
function moveBefore(from,to){if(!from||from===to)return;const next=state.ranking.filter(x=>x!==from);next.splice(next.indexOf(to),0,from);state.ranking=next;save();renderRank();notice(from+' 已移到 '+to+' 前面')}
function moveBy(id,delta){const at=state.ranking.indexOf(id),to=at+delta;if(to<0||to>=state.ranking.length)return;[state.ranking[at],state.ranking[to]]=[state.ranking[to],state.ranking[at]];save();renderRank();notice(id+' 現在是第 '+(to+1)+' 名')}
function ready(){const missing=ids.filter(id=>state.decisions[id]==='unreviewed');if(!missing.length)return true;notice('還有 '+missing.length+' 則未評；先完成「留／待定／淘汰」再匯出。');document.querySelector('article[data-id="'+missing[0]+'"]').scrollIntoView({behavior:'smooth',block:'center'});return false}
function exportState(){const out={...state,submitted_at:new Date().toISOString()};if(!valid(out))throw new Error('評選資料不完整');return JSON.stringify(out,null,2)+'\\n'}
document.getElementById('download').addEventListener('click',()=>{if(!ready())return;const blob=new Blob([exportState()],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='gp-273-mogunote-ranking.json';a.click();URL.revokeObjectURL(url);notice('已下載 JSON')});
document.getElementById('copy').addEventListener('click',async()=>{if(!ready())return;const value=exportState();try{await navigator.clipboard.writeText(value)}catch{const area=document.createElement('textarea');area.value=value;document.body.append(area);area.select();document.execCommand('copy');area.remove()}notice('已複製 JSON')});
document.getElementById('reset').addEventListener('click',()=>{if(!confirm('清除這一版的所有判定與評論？'))return;localStorage.removeItem(STORAGE_KEY);state=blank();render();notice('已重設')});
render();
</script>
</body>
</html>`;
}

export async function generateBoard(root, outputPath) {
  const packet = JSON.parse(
    await fs.readFile(path.join(root, 'collector', 'blind-packet.json'), 'utf8')
  );
  const html = renderBoardHTML(packet);
  await fs.writeFile(outputPath, html, { mode: 0o600 });
  return { outputPath, boardSha256: packet.board_sha256, entryCount: packet.entries.length };
}

export async function reconcileExperiment(root) {
  const resolvedRoot = await fs.realpath(root);
  const inputs = await readInputs(resolvedRoot);
  const cellsPath = path.join(resolvedRoot, 'collector', 'cells.private.json');
  const probesPath = path.join(resolvedRoot, 'collector', 'probes.json');
  const mappingPath = path.join(resolvedRoot, 'collector', 'mapping.private.json');
  const [cells, probes, mapping] = await Promise.all([
    fs.readFile(cellsPath, 'utf8').then(JSON.parse),
    fs.readFile(probesPath, 'utf8').then(JSON.parse),
    fs.readFile(mappingPath, 'utf8').then(JSON.parse),
  ]);
  const attemptsByUUID = new Map();
  for (const cell of cells) {
    const spec = MODEL_SPECS.find((candidate) => candidate.model === cell.requested_model);
    if (!spec) throw new Error(`unknown model in cell ${cell.requested_model}`);
    for (const attempt of cell.attempts) {
      const manifestPath = path.join(attempt.cwd, 'manifest.json');
      const rawOutput = await fs.readFile(path.join(attempt.cwd, 'stdout.json'), 'utf8');
      let transportOutput = rawOutput;
      try {
        transportOutput = await fs.readFile(path.join(attempt.cwd, 'transport.jsonl'), 'utf8');
      } catch {
        // Claude and Grok keep transport metadata in stdout.json.
      }
      const provenance = extractTransportProvenance(spec, rawOutput, transportOutput);
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
      let candidateSha = null;
      try {
        const candidate = JSON.parse(
          await fs.readFile(path.join(attempt.cwd, 'candidate.json'), 'utf8')
        );
        candidateSha = sha256(stableJSON(candidate));
      } catch {
        // Invalid attempts intentionally have no normalized candidate.
      }
      Object.assign(attempt, {
        actual_model: provenance.actualModel,
        provider_reported_models: provenance.providerReportedModels,
        provider_session_id: provenance.providerSessionId,
      });
      attemptsByUUID.set(attempt.run_uuid, attempt);
      await writePrivateJSON(manifestPath, {
        ...manifest,
        actual_model: provenance.actualModel,
        provider_reported_models: provenance.providerReportedModels,
        provider_session_id: provenance.providerSessionId,
        source_sha256: inputs.sourceSha256,
        translation_sha256: inputs.translationSha256,
        base_prompt_sha256: cell.base_prompt_sha256,
        validation_status: attempt.validation_error ? 'INVALID' : 'VALID',
        validation_error: attempt.validation_error,
        candidate_sha256: candidateSha,
      });
    }
    const accepted = [...cell.attempts].reverse().find((attempt) => !attempt.validation_error);
    cell.actual_model = accepted?.actual_model ?? null;
    cell.final_error = cell.status === 'VALID' ? null : cell.final_error;
  }
  for (const entry of mapping.cells ?? mapping.entries) {
    if (!entry.run_uuid) continue;
    const attempt = attemptsByUUID.get(entry.run_uuid);
    if (!attempt) throw new Error(`mapping references unknown run ${entry.run_uuid}`);
    entry.actual_model = attempt.actual_model;
    entry.provider_reported_models = attempt.provider_reported_models;
    entry.provider_session_id = attempt.provider_session_id;
  }
  for (const probe of probes) {
    const spec = MODEL_SPECS.find((candidate) => candidate.model === probe.requested_model);
    const probeDir = path.join(resolvedRoot, 'probes', probe.run_uuid);
    const rawOutput = await fs.readFile(path.join(probeDir, 'stdout.json'), 'utf8');
    let transportOutput = rawOutput;
    try {
      transportOutput = await fs.readFile(path.join(probeDir, 'transport.jsonl'), 'utf8');
    } catch {
      // Claude and Grok keep transport metadata in stdout.json.
    }
    const provenance = extractTransportProvenance(spec, rawOutput, transportOutput);
    probe.actual_model = probe.status === 'AVAILABLE' ? provenance.actualModel : null;
    probe.provider_reported_models = provenance.providerReportedModels;
    probe.provider_session_id = provenance.providerSessionId;
    const manifestPath = path.join(probeDir, 'manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    await writePrivateJSON(manifestPath, {
      ...manifest,
      actual_model: probe.actual_model,
      provider_reported_models: probe.provider_reported_models,
      provider_session_id: probe.provider_session_id,
      validation_status: probe.status,
      validation_error: probe.validation_error,
    });
  }
  await Promise.all([
    writePrivateJSON(cellsPath, cells),
    writePrivateJSON(probesPath, probes),
    writePrivateJSON(mappingPath, mapping),
  ]);
  return {
    cells: cells.length,
    attempts: attemptsByUUID.size,
    probes: probes.length,
    provider_sessions: [...attemptsByUUID.values()].filter((attempt) => attempt.provider_session_id)
      .length,
  };
}

async function assertMode(target, expected, kind) {
  const stat = await fs.lstat(target);
  if (stat.isSymbolicLink()) throw new Error(`${target} must not be a symlink`);
  if (kind === 'directory' && !stat.isDirectory()) throw new Error(`${target} must be a directory`);
  if (kind === 'file' && !stat.isFile()) throw new Error(`${target} must be a regular file`);
  if ((stat.mode & 0o777) !== expected) {
    throw new Error(
      `${target} mode ${(stat.mode & 0o777).toString(8)}, want ${expected.toString(8)}`
    );
  }
}

export async function verifyIsolation(root, boardPath) {
  const realRoot = await fs.realpath(root);
  if (!realRoot.startsWith(PRIVATE_ROOT_PREFIX)) throw new Error('unexpected experiment root');
  await assertMode(realRoot, 0o700, 'directory');
  for (const name of ['inputs', 'probes', 'runs', 'collector']) {
    await assertMode(path.join(realRoot, name), 0o700, 'directory');
  }
  const cells = JSON.parse(
    await fs.readFile(path.join(realRoot, 'collector', 'cells.private.json'), 'utf8')
  );
  const runIds = [];
  const cwds = [];
  const sessions = [];
  const providerSessions = [];
  for (const cell of cells) {
    for (const attempt of cell.attempts) {
      runIds.push(attempt.run_uuid);
      cwds.push(await fs.realpath(attempt.cwd));
      sessions.push(attempt.isolation_session_id);
      if (attempt.provider_session_id) providerSessions.push(attempt.provider_session_id);
      await assertMode(attempt.cwd, 0o700, 'directory');
      for (const file of [
        'prompt.txt',
        'schema.json',
        'manifest.json',
        'stdout.json',
        'stderr.log',
      ]) {
        await assertMode(path.join(attempt.cwd, file), 0o600, 'file');
      }
    }
  }
  for (const [name, values] of Object.entries({ runIds, cwds, sessions, providerSessions })) {
    if (new Set(values).size !== values.length) throw new Error(`${name} contains duplicates`);
  }
  const mappingText = await fs.readFile(
    path.join(realRoot, 'collector', 'mapping.private.json'),
    'utf8'
  );
  const mapping = JSON.parse(mappingText);
  for (const spec of MODEL_SPECS) {
    const pair = (mapping.cells ?? mapping.entries).filter(
      (entry) => entry.requested_model === spec.model
    );
    if (pair.length === 2 && pair[0].isolation_session_id === pair[1].isolation_session_id) {
      throw new Error(`${spec.model} prompt arms share a session id`);
    }
    if (
      pair.length === 2 &&
      pair[0].provider_session_id &&
      pair[0].provider_session_id === pair[1].provider_session_id
    ) {
      throw new Error(`${spec.model} prompt arms share a provider session id`);
    }
  }
  if (boardPath) {
    const board = await fs.readFile(boardPath, 'utf8');
    const forbidden = [
      ...MODEL_SPECS.map((spec) => spec.model),
      'provider',
      'requested_model',
      'actual_model',
      'current',
      'revised',
      '/private/tmp',
      '/Users/',
      ...runIds,
      ...sessions,
    ];
    for (const token of forbidden) {
      if (board.includes(token)) throw new Error(`board leaks forbidden token ${token}`);
    }
    const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
    if (uuidPattern.test(board)) throw new Error('board leaks a UUID');
  }
  return {
    runCount: runIds.length,
    uniqueCwds: cwds.length,
    uniqueSessions: sessions.length,
    uniqueProviderSessions: providerSessions.length,
  };
}

export function validateRankingResult(result, packet) {
  assertPlainObject(result, 'ranking result');
  if (result.schema_version !== RESULT_SCHEMA_VERSION) throw new Error('ranking schema mismatch');
  if (result.experiment_id !== packet.experiment_id) throw new Error('ranking experiment mismatch');
  if (result.board_sha256 !== packet.board_sha256) throw new Error('ranking board hash is stale');
  if (!result.submitted_at || Number.isNaN(Date.parse(result.submitted_at))) {
    throw new Error('ranking submitted_at is missing');
  }
  const ids = packet.entries.map((entry) => entry.id);
  const ranking = result.ranking;
  if (!Array.isArray(ranking) || new Set(ranking).size !== ranking.length) {
    throw new Error('ranking contains duplicates or is not an array');
  }
  if (ranking.some((id) => !ids.includes(id))) throw new Error('ranking contains an unknown id');
  for (const id of ids) {
    if (!['keep', 'pending', 'reject'].includes(result.decisions?.[id])) {
      throw new Error(`missing decision for ${id}`);
    }
    if (typeof result.comments?.[id] !== 'string') throw new Error(`missing comment for ${id}`);
  }
  const keep = ids.filter((id) => result.decisions[id] === 'keep');
  if (ranking.length !== keep.length || keep.some((id) => !ranking.includes(id))) {
    throw new Error('ranking must contain every keep id exactly once');
  }
  return result;
}

function compareBlindIds(left, right, result) {
  const bucket = { keep: 2, pending: 1, reject: 0 };
  const leftBucket = bucket[result.decisions[left]];
  const rightBucket = bucket[result.decisions[right]];
  if (leftBucket !== rightBucket) return Math.sign(leftBucket - rightBucket);
  if (leftBucket === bucket.keep) {
    return Math.sign(result.ranking.indexOf(right) - result.ranking.indexOf(left));
  }
  return 0;
}

export async function revealResults(root, resultPath) {
  const [packetText, mappingText, resultText] = await Promise.all([
    fs.readFile(path.join(root, 'collector', 'blind-packet.json'), 'utf8'),
    fs.readFile(path.join(root, 'collector', 'mapping.private.json'), 'utf8'),
    fs.readFile(resultPath, 'utf8'),
  ]);
  const packet = JSON.parse(packetText);
  const mapping = JSON.parse(mappingText);
  const result = validateRankingResult(JSON.parse(resultText), packet);
  if (mapping.board_sha256 !== packet.board_sha256) throw new Error('private mapping is stale');
  const byId = new Map(mapping.entries.map((entry) => [entry.id, entry]));
  const mappedCells = mapping.cells ?? mapping.entries;
  const pairResults = [];
  const models = [...new Set(mappedCells.map((entry) => entry.requested_model).filter(Boolean))];
  for (const model of models) {
    const current = mappedCells.find(
      (entry) => entry.requested_model === model && entry.arm === 'current'
    );
    const revised = mappedCells.find(
      (entry) => entry.requested_model === model && entry.arm === 'revised'
    );
    if (!current || !revised) continue;
    const comparison = compareBlindIds(revised.id, current.id, result);
    pairResults.push({
      model,
      current_id: current.id,
      revised_id: revised.id,
      outcome: comparison > 0 ? 'revised' : comparison < 0 ? 'current' : 'tie',
    });
  }
  const ranked = packet.entries
    .map((entry) => entry.id)
    .sort((left, right) => compareBlindIds(right, left, result))
    .map((id) => ({
      id,
      ...byId.get(id),
      decision: result.decisions[id],
      comment: result.comments[id],
    }));
  const counts = pairResults.reduce(
    (acc, pair) => ({ ...acc, [pair.outcome]: acc[pair.outcome] + 1 }),
    { revised: 0, current: 0, tie: 0 }
  );
  const reveal = {
    schema_version: EXPERIMENT_SCHEMA_VERSION,
    experiment_id: packet.experiment_id,
    board_sha256: packet.board_sha256,
    result_sha256: sha256(resultText),
    revealed_at: new Date().toISOString(),
    ranked,
    pair_results: pairResults,
    arm_summary: {
      ...counts,
      decisive_pairs: counts.revised + counts.current,
      revised_win_rate:
        counts.revised + counts.current === 0
          ? null
          : counts.revised / (counts.revised + counts.current),
    },
  };
  await writePrivateJSON(path.join(root, 'collector', 'reveal.private.json'), reveal);
  return reveal;
}

export async function loadBlindPacket(root) {
  return JSON.parse(await fs.readFile(path.join(root, 'collector', 'blind-packet.json'), 'utf8'));
}
