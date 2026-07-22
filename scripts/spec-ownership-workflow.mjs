import { parse as parseYAML } from 'yaml';

export const VALID_CLASSES = new Set(['blocking', 'nightly', 'quarantined']);

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
  let workflow;
  try {
    workflow = parseYAML(text);
  } catch (error) {
    return [`INVALID WORKFLOW YAML: ${rel}: ${error.message}`];
  }

  const wiringErrors = [];
  for (const [jobName, job] of Object.entries(workflow?.jobs ?? {})) {
    for (const [stepIndex, step] of (job?.steps ?? []).entries()) {
      if (typeof step?.run !== 'string') continue;
      const commands = shellLogicalLines(step.run);
      const playwrightCommands = commands.filter((command) => PLAYWRIGHT_TEST_RE.test(command));
      if (playwrightCommands.length === 0) continue;

      const stepName = step.name || `step ${stepIndex + 1}`;
      const location = `${rel} job "${jobName}" step "${stepName}"`;
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
  }
  return wiringErrors;
}
