import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '..');
const ACTION_CONFIG_ROOTS = ['.github/workflows', '.github/actions'];
const IMMUTABLE_ACTION_REF = /^[^@\s]+@[0-9a-f]{40}$/;
const READABLE_VERSION = /^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

type ActionUse = {
  file: string;
  line: number;
  reference: string;
  versionComment?: string;
};

function yamlFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return yamlFiles(entryPath);
    return /\.ya?ml$/.test(entry.name) ? [entryPath] : [];
  });
}

function parseExternalActionUse(line: string, file: string, lineNumber: number): ActionUse[] {
  const match = line.match(/^\s*(?:-\s*)?uses:\s*([^#\s]+)(?:\s+#\s*(.*))?$/);
  if (!match) return [];
  const [, reference, comment] = match;
  if (reference.startsWith('./') || reference.startsWith('docker://')) return [];
  return [
    {
      file,
      line: lineNumber,
      reference,
      versionComment: comment?.trim().split(/\s+/, 1)[0],
    },
  ];
}

function externalActionUses(): ActionUse[] {
  return ACTION_CONFIG_ROOTS.flatMap((root) => yamlFiles(path.join(REPO_ROOT, root)))
    .flatMap((file) =>
      fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, index) =>
          parseExternalActionUse(line, path.relative(REPO_ROOT, file), index + 1)
        )
    )
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

describe('GitHub Actions supply-chain pins', () => {
  it('does not let extra comment prose hide a floating action ref', () => {
    expect(
      parseExternalActionUse('  - uses: owner/action@v1 # v1.2.3 update note', 'fixture.yml', 7)
    ).toEqual([
      {
        file: 'fixture.yml',
        line: 7,
        reference: 'owner/action@v1',
        versionComment: 'v1.2.3',
      },
    ]);
  });

  it('pins every external action to a commit SHA with a readable release comment', () => {
    const actionUses = externalActionUses();
    expect(actionUses.length).toBeGreaterThan(0);

    const violations = actionUses.flatMap(({ file, line, reference, versionComment }) => {
      const location = `${file}:${line}`;
      const failures: string[] = [];
      if (!IMMUTABLE_ACTION_REF.test(reference)) {
        failures.push(`${location} has floating ref ${reference}`);
      }
      if (!versionComment || !READABLE_VERSION.test(versionComment)) {
        failures.push(`${location} lacks an exact semver comment`);
      }
      return failures;
    });

    expect(violations).toEqual([]);
  });
});
