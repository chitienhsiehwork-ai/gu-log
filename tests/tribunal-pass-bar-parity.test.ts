/**
 * PASS bar parity (openspec tribunal-scoring-dimensions).
 *
 * The production gate is `check_pass_bar` in scripts/tribunal.sh (inline
 * Python); the site decides the publish bar in src/utils/tribunal-scores.ts.
 * Each case below is fed to both and must match the bar the spec defines, so
 * changing one side alone turns this test red.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { meetsPublishBar } from '../src/utils/tribunal-scores';
import { useTestTempDirectories } from './helpers/temp-directories';

type Scorecard = NonNullable<Parameters<typeof meetsPublishBar>[0]>;
type Judge = 'vibe' | 'factCheck' | 'librarian' | 'freshEyes';
type Version = 8 | 9;
type Dims = Record<string, number>;

interface PassBarCase {
  name: string;
  judge: Judge;
  version: Version;
  dims: Dims;
  pass: boolean;
}

const ROOT = path.resolve(import.meta.dirname, '..');
const TRIBUNAL_SOURCE = readFileSync(path.join(ROOT, 'scripts', 'tribunal.sh'), 'utf8');
const makeTempDirectory = useTestTempDirectories({ cleanup: 'afterAll' });

function extractCheckPassBar(): string {
  const match = TRIBUNAL_SOURCE.match(/^check_pass_bar\(\) \{\n[\s\S]*?\n\}\n/m);
  if (!match) throw new Error('check_pass_bar() not found in scripts/tribunal.sh');
  return match[0];
}

/** fm_judge_key -> validate_name, read from the STAGES table tribunal.sh runs. */
function stageGates(): Map<string, string> {
  const block = TRIBUNAL_SOURCE.match(/^declare -a STAGES=\(\n([\s\S]*?)\n\)/m);
  if (!block) throw new Error('STAGES table not found in scripts/tribunal.sh');
  const gates = new Map<string, string>();
  for (const line of block[1].split('\n')) {
    const fields = line.trim().replace(/^"|"$/g, '').split(':');
    if (fields.length !== 6) throw new Error(`unexpected STAGES entry: ${line}`);
    gates.set(fields[5], fields[2]);
  }
  return gates;
}

const composite = (dims: Dims) => {
  const values = Object.values(dims);
  return Math.floor(values.reduce((sum, n) => sum + n, 0) / values.length);
};

const all8 = (keys: readonly string[]): Dims => Object.fromEntries(keys.map((k) => [k, 8]));

const VIBE_V9 = ['persona', 'moguNote', 'vibe', 'narrative'] as const;
const VIBE_V8 = ['persona', 'moguNote', 'vibe', 'clarity', 'narrative'] as const;
const FRESH_V9 = [
  'readability',
  'firstImpression',
  'payoffDensity',
  'lengthFit',
  'clarity',
] as const;
const FRESH_V8 = ['readability', 'firstImpression', 'payoffDensity', 'lengthFit'] as const;
const FACT = [
  'accuracy',
  'fidelity',
  'consistency',
  'sourceBoundary',
  'commentarySeparation',
] as const;
const LIBRARIAN = ['glossary', 'crossRef', 'sourceAlign', 'attribution'] as const;

function passingScorecard(version: Version): Scorecard {
  const entry = (dims: Dims) => ({ ...dims, score: composite(dims), date: '2026-10-22' });
  return {
    tribunalVersion: version,
    vibe: entry({ ...all8(version >= 9 ? VIBE_V9 : VIBE_V8), persona: 9 }),
    factCheck: entry(all8(FACT)),
    librarian: entry(all8(LIBRARIAN)),
    freshEyes: entry(all8(version >= 9 ? FRESH_V9 : FRESH_V8)),
  } as Scorecard;
}

// Expected verdicts follow the pass bars in openspec tribunal-scoring-dimensions.
const CASES: PassBarCase[] = [
  // Vibe: composite >= 8 AND one dim >= 9 AND no dim < 8 (owned dims by version)
  {
    name: 'vibe v9 meets the bar',
    judge: 'vibe',
    version: 9,
    dims: { persona: 9, moguNote: 8, vibe: 8, narrative: 8 },
    pass: true,
  },
  {
    name: 'vibe v9 without a dim at 9',
    judge: 'vibe',
    version: 9,
    dims: { persona: 8, moguNote: 8, vibe: 8, narrative: 8 },
    pass: false,
  },
  {
    name: 'vibe v9 with one dim at 7',
    judge: 'vibe',
    version: 9,
    dims: { persona: 10, moguNote: 10, vibe: 10, narrative: 7 },
    pass: false,
  },
  {
    name: 'vibe v8 meets the bar',
    judge: 'vibe',
    version: 8,
    dims: { persona: 9, moguNote: 8, vibe: 8, clarity: 8, narrative: 8 },
    pass: true,
  },
  {
    name: 'vibe v8 clarity at 7',
    judge: 'vibe',
    version: 8,
    dims: { persona: 10, moguNote: 10, vibe: 10, clarity: 7, narrative: 10 },
    pass: false,
  },
  // Fresh Eyes: composite >= 8 AND payoffDensity, lengthFit (and v9 clarity) >= 8
  {
    name: 'fresh eyes v9 at 8 everywhere',
    judge: 'freshEyes',
    version: 9,
    dims: all8(FRESH_V9),
    pass: true,
  },
  {
    name: 'fresh eyes v9 readability 7 is compensated',
    judge: 'freshEyes',
    version: 9,
    dims: { readability: 7, firstImpression: 9, payoffDensity: 9, lengthFit: 9, clarity: 9 },
    pass: true,
  },
  {
    name: 'fresh eyes v9 composite 7',
    judge: 'freshEyes',
    version: 9,
    dims: { readability: 7, firstImpression: 7, payoffDensity: 8, lengthFit: 8, clarity: 8 },
    pass: false,
  },
  {
    name: 'fresh eyes v9 clarity 7',
    judge: 'freshEyes',
    version: 9,
    dims: { readability: 10, firstImpression: 10, payoffDensity: 10, lengthFit: 10, clarity: 7 },
    pass: false,
  },
  {
    name: 'fresh eyes v9 payoffDensity 7',
    judge: 'freshEyes',
    version: 9,
    dims: { readability: 10, firstImpression: 10, payoffDensity: 7, lengthFit: 10, clarity: 10 },
    pass: false,
  },
  {
    name: 'fresh eyes v9 lengthFit 7',
    judge: 'freshEyes',
    version: 9,
    dims: { readability: 10, firstImpression: 10, payoffDensity: 10, lengthFit: 7, clarity: 10 },
    pass: false,
  },
  {
    name: 'fresh eyes v8 passes without clarity',
    judge: 'freshEyes',
    version: 8,
    dims: all8(FRESH_V8),
    pass: true,
  },
  {
    name: 'fresh eyes v9 fails without clarity',
    judge: 'freshEyes',
    version: 9,
    dims: all8(FRESH_V8),
    pass: false,
  },
  {
    name: 'fresh eyes v8 payoffDensity 7',
    judge: 'freshEyes',
    version: 8,
    dims: { readability: 10, firstImpression: 10, payoffDensity: 7, lengthFit: 10 },
    pass: false,
  },
  // Librarian: composite >= 8, no per-dimension gate
  {
    name: 'librarian at 8 everywhere',
    judge: 'librarian',
    version: 9,
    dims: all8(LIBRARIAN),
    pass: true,
  },
  {
    name: 'librarian composite 8 with a low dim',
    judge: 'librarian',
    version: 9,
    dims: { glossary: 10, crossRef: 10, sourceAlign: 10, attribution: 2 },
    pass: true,
  },
  {
    name: 'librarian composite 7',
    judge: 'librarian',
    version: 9,
    dims: { glossary: 7, crossRef: 7, sourceAlign: 8, attribution: 9 },
    pass: false,
  },
  // Fact Checker: floor(avg(accuracy, fidelity, consistency)) >= 8 AND sourceBoundary, commentarySeparation >= 8
  {
    name: 'fact checker at 8 everywhere',
    judge: 'factCheck',
    version: 9,
    dims: all8(FACT),
    pass: true,
  },
  {
    name: 'fact checker core floors to 8',
    judge: 'factCheck',
    version: 9,
    dims: { accuracy: 7, fidelity: 8, consistency: 9, sourceBoundary: 8, commentarySeparation: 8 },
    pass: true,
  },
  {
    name: 'fact checker core floors to 7',
    judge: 'factCheck',
    version: 9,
    dims: {
      accuracy: 7,
      fidelity: 7,
      consistency: 9,
      sourceBoundary: 10,
      commentarySeparation: 10,
    },
    pass: false,
  },
  {
    name: 'fact checker sourceBoundary 7',
    judge: 'factCheck',
    version: 9,
    dims: {
      accuracy: 10,
      fidelity: 10,
      consistency: 10,
      sourceBoundary: 7,
      commentarySeparation: 10,
    },
    pass: false,
  },
  {
    name: 'fact checker commentarySeparation 7',
    judge: 'factCheck',
    version: 9,
    dims: {
      accuracy: 10,
      fidelity: 10,
      consistency: 10,
      sourceBoundary: 10,
      commentarySeparation: 7,
    },
    pass: false,
  },
];

function shellVerdicts(cases: PassBarCase[]): boolean[] {
  const gates = stageGates();
  const dir = makeTempDirectory('tribunal-pass-bar-parity-');
  const functionFile = path.join(dir, 'check-pass-bar.sh');
  writeFileSync(functionFile, extractCheckPassBar());

  const manifest = cases.map((testCase, index) => {
    const validateName = gates.get(testCase.judge);
    if (!validateName) throw new Error(`tribunal.sh STAGES has no gate for ${testCase.judge}`);
    const jsonFile = path.join(dir, `case-${index}.json`);
    writeFileSync(
      jsonFile,
      JSON.stringify({ dimensions: testCase.dims, score: composite(testCase.dims) })
    );
    return `${validateName}\t${testCase.version}\t${jsonFile}`;
  });
  const manifestFile = path.join(dir, 'cases.tsv');
  writeFileSync(manifestFile, `${manifest.join('\n')}\n`);

  const runner = [
    'set -u',
    'tlog() { :; }',
    'source "$1"',
    "while IFS=$'\\t' read -r name version file; do",
    '  if TRIBUNAL_VERSION="$version" check_pass_bar "$name" "$file"; then echo PASS; else echo FAIL; fi',
    'done < "$2"',
  ].join('\n');
  const result = spawnSync('bash', ['-c', runner, 'parity', functionFile, manifestFile], {
    encoding: 'utf8',
  });
  expect(result.status, result.stderr).toBe(0);
  const lines = result.stdout.trim().split('\n');
  expect(lines).toHaveLength(cases.length);
  return lines.map((line) => line === 'PASS');
}

function siteVerdict(testCase: PassBarCase): boolean {
  const scorecard = passingScorecard(testCase.version);
  scorecard[testCase.judge] = {
    ...testCase.dims,
    score: composite(testCase.dims),
    date: '2026-10-22',
  } as never;
  return meetsPublishBar(scorecard);
}

describe('Tribunal PASS bar parity: tribunal.sh check_pass_bar vs tribunal-scores.ts', () => {
  let shell: boolean[] = [];
  beforeAll(() => {
    shell = shellVerdicts(CASES);
  });

  it.each(CASES.map((testCase, index) => [testCase.name, index] as const))('%s', (_name, index) => {
    const testCase = CASES[index];
    expect({ shell: shell[index], site: siteVerdict(testCase) }).toEqual({
      shell: testCase.pass,
      site: testCase.pass,
    });
  });

  it('requires every judge tribunal.sh runs, and only those four', () => {
    const judges = [...stageGates().keys()].sort();
    expect(judges).toEqual(['factCheck', 'freshEyes', 'librarian', 'vibe']);

    for (const version of [8, 9] as const) {
      expect(meetsPublishBar(passingScorecard(version)), `v${version} baseline`).toBe(true);
      for (const judge of judges) {
        const scorecard = passingScorecard(version);
        delete scorecard[judge as Judge];
        expect(meetsPublishBar(scorecard), `v${version} without ${judge}`).toBe(false);
      }
    }
  });
});
