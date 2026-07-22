export const VALID_CLASSES = new Set(['blocking', 'nightly', 'quarantined']);

function unquote(value) {
  const quote = value[0];
  return quote && quote === value.at(-1) && (quote === '"' || quote === "'")
    ? value.slice(1, -1)
    : value;
}

function extractWorkflowRunBlocks(text) {
  const lines = text.split('\n');
  const blocks = [];
  let inJobs = false;
  let jobName = null;
  let stepIndex = 0;
  let stepName = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const indent = line.match(/^ */)[0].length;
    const trimmed = line.trim();

    if (indent === 0 && trimmed && !trimmed.startsWith('#')) {
      inJobs = trimmed === 'jobs:';
      jobName = null;
      continue;
    }
    if (!inJobs) continue;

    const jobMatch = line.match(/^ {2}([A-Za-z0-9_-]+):(?:\s*(?:#.*)?)$/);
    if (jobMatch) {
      jobName = jobMatch[1];
      stepIndex = 0;
      stepName = null;
      continue;
    }
    if (!jobName) continue;

    const stepMatch = line.match(/^ {6}-\s*(.*)$/);
    let property = null;
    let propertyIndent = 8;
    if (stepMatch) {
      stepIndex += 1;
      stepName = null;
      property = stepMatch[1];
      propertyIndent = 6;
    } else if (indent === 8) {
      property = trimmed;
    }
    if (property === null) continue;

    const nameMatch = property.match(/^name:\s*(.*?)\s*$/);
    if (nameMatch) stepName = unquote(nameMatch[1]);

    const runMatch = property.match(/^run:\s*(.*?)\s*$/);
    if (!runMatch) continue;
    const value = runMatch[1];
    let run = unquote(value);
    if (/^[>|][+-]?$/.test(value)) {
      const body = [];
      let bodyIndent = null;
      while (index + 1 < lines.length) {
        const candidate = lines[index + 1];
        const candidateIndent = candidate.match(/^ */)[0].length;
        if (
          candidate.trim() &&
          (bodyIndent === null ? candidateIndent <= propertyIndent : candidateIndent < bodyIndent)
        ) {
          break;
        }
        index += 1;
        if (!candidate.trim()) {
          body.push('');
          continue;
        }
        bodyIndent ??= candidateIndent;
        body.push(candidate.slice(Math.min(bodyIndent, candidateIndent)));
      }
      run = value.startsWith('>') ? body.join(' ') : body.join('\n');
    }

    blocks.push({ jobName, stepIndex, stepName, run });
  }
  return blocks;
}

function shellLogicalLines(run) {
  const commands = [];
  let continued = '';
  for (const rawLine of run.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.endsWith('\\')) {
      continued += `${line.slice(0, -1).trimEnd()} `;
      continue;
    }
    commands.push(`${continued}${line}`.trim());
    continued = '';
  }
  if (continued.trim()) commands.push(continued.trim());
  return commands;
}

const PLAYWRIGHT_TEST_RE = /\bplaywright\s+test\b/;
// This exact checked-assignment shape is the workflow contract: under
// `set -e`, its exit status cannot be swallowed as bare command substitution.
const CHECKED_LIST_ASSIGNMENT_RE =
  /^([A-Za-z_][A-Za-z0-9_]*)=\$\(node scripts\/check-spec-ownership\.mjs --list ([A-Za-z0-9_-]+)\)$/;

export function validateWorkflowRunBlocks(rel, text, expectedClassesByJob = {}) {
  const wiringErrors = [];
  for (const { jobName, stepIndex, stepName, run } of extractWorkflowRunBlocks(text)) {
    const commands = shellLogicalLines(run);
    const playwrightCommands = commands.filter((command) => PLAYWRIGHT_TEST_RE.test(command));
    if (playwrightCommands.length === 0) continue;

    const location = `${rel} job "${jobName}" step "${stepName || `step ${stepIndex}`}"`;
    const expectedClass = expectedClassesByJob[jobName] ?? null;
    const assignments = commands
      .map((command) => command.match(CHECKED_LIST_ASSIGNMENT_RE))
      .filter((match) => match && VALID_CLASSES.has(match[2]));
    const matchingAssignments = expectedClass
      ? assignments.filter((match) => match[2] === expectedClass)
      : assignments;

    if (assignments.length !== 1 || matchingAssignments.length !== 1) {
      const classLabel = expectedClass ? ` ${expectedClass}` : '';
      wiringErrors.push(
        `${location} runs Playwright but must contain exactly one checked --list${classLabel} assignment in the same run block.`
      );
      continue;
    }
    if (!commands.includes('set -euo pipefail')) {
      wiringErrors.push(
        `${location} must run its checked --list assignment under set -euo pipefail.`
      );
    }

    const variable = matchingAssignments[0][1];
    const variableUse = new RegExp(`\\$(?:${variable}\\b|\\{${variable}\\})`);
    for (const command of playwrightCommands) {
      if (!variableUse.test(command)) {
        wiringErrors.push(
          `${location} must pass the checked --list output via $${variable} to every Playwright test command in that run block.`
        );
      }
    }
  }
  return wiringErrors;
}
