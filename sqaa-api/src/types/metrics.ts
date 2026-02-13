/**
 * TypeScript types for all SQAA Dashboard metrics.
 * Maps 1:1 to the JSON files in quality/.
 */

// ─── Shared ──────────────────────────────────────────────

export type Trend = 'improving' | 'stable' | 'degrading';
export type OverallHealth = 'healthy' | 'warning' | 'critical';

export interface MetricResponse<TCurrent, THistory> {
  current: TCurrent;
  baseline: TCurrent;
  history: THistory[];
  trend: Trend;
}

export interface ErrorResponse {
  error: string;
  code: number;
  details?: unknown;
}

export interface HealthResponse {
  status: 'ok';
  version: string;
  uptime: number;
  timestamp: string;
}

// ─── Security ────────────────────────────────────────────

export interface VulnerabilitySeverities {
  info: number;
  low: number;
  moderate: number;
  high: number;
  critical: number;
}

export interface SecurityVulnerability {
  name: string;
  severity: string;
  isDirect: boolean;
  via: (string | VulnerabilityAdvisory)[];
  effects: string[];
  range: string;
  nodes: string[];
  fixAvailable: FixAvailable | boolean;
}

export interface VulnerabilityAdvisory {
  source: number;
  name: string;
  dependency: string;
  title: string;
  url: string;
  severity: string;
  cwe: string[];
  cvss: { score: number; vectorString: string };
  range: string;
}

export interface FixAvailable {
  name: string;
  version: string;
  isSemVerMajor: boolean;
}

export interface SecurityBaseline {
  auditReportVersion: number;
  vulnerabilities: Record<string, SecurityVulnerability>;
  metadata: {
    vulnerabilities: VulnerabilitySeverities & { total: number };
    dependencies: {
      prod: number;
      dev: number;
      optional: number;
      peer: number;
      peerOptional: number;
      total: number;
    };
  };
  baselineDate: string;
}

export interface SecurityHistoryEntry {
  date: string;
  total: number;
  severities: VulnerabilitySeverities;
  hasHighOrCritical: boolean;
}

export interface SecurityCurrent {
  total: number;
  severities: VulnerabilitySeverities;
  hasHighOrCritical: boolean;
  vulnerabilities: Record<string, SecurityVulnerability>;
}

// ─── ESLint / Code Quality ───────────────────────────────

export interface EslintBaseline {
  timestamp: string;
  baseline: {
    eslint: {
      totalProblems: number;
      errors: number;
      warnings: number;
    };
    prettier: {
      filesWithFormattingIssues: number;
      filesWithParseErrors: number;
      note: string;
    };
  };
  afterAutoFix: {
    eslint: {
      totalProblems: number;
      errors: number;
      warnings: number;
      autoFixed: number;
      remainingDetails: string[];
    };
    prettier: {
      filesFormatted: number;
      remainingFormattingIssues: number;
      remainingParseErrors: number;
      note: string;
    };
    filesChanged: number;
  };
}

export interface EslintCurrent {
  timestamp: string;
  errors: number;
  warnings: number;
  totalProblems: number;
  prettierIssues: number;
  remainingDetails: string[];
}

// ─── Lighthouse ──────────────────────────────────────────

export interface LighthouseScores {
  performance: number;
  accessibility: number;
  'best-practices': number;
  seo: number;
}

export interface CoreWebVitals {
  FCP_ms: number;
  LCP_ms: number;
  TBT_ms: number;
  CLS: number;
  SI_ms: number;
}

export interface LighthousePageResult {
  scores: LighthouseScores;
  coreWebVitals: CoreWebVitals;
}

export interface LighthouseBaseline {
  date: string;
  pages: Record<string, LighthousePageResult>;
}

export interface LighthouseCurrent {
  date: string;
  pages: Record<string, LighthousePageResult>;
  averageScores: {
    performance: number;
    accessibility: number;
    bestPractices: number;
    seo: number;
  };
}

// ─── Coverage ────────────────────────────────────────────

export interface CoverageBaseline {
  date: string;
  testsRun: string;
  totalTests: number;
  passed: number;
  failed: number;
  bytes: number;
  statements: number;
  branches: number;
  functions: number;
  lines: number;
  skippedTests: string[];
  stableTests: string[];
}

export interface CoverageHistoryEntry {
  date: string;
  statements: number;
  branches: number;
  functions: number;
  lines: number;
  testsRun: number;
  note: string;
}

export interface CoverageCurrent {
  date: string;
  statements: number;
  branches: number;
  functions: number;
  lines: number;
  totalTests: number;
  passed: number;
  failed: number;
}

// ─── Bundle ──────────────────────────────────────────────

export interface BundleSizeBaseline {
  timestamp: string;
  totalKB: number;
  jsKB: number;
  cssKB: number;
  htmlKB: number;
  imgKB: number;
  otherKB: number;
  fileCount: number;
  top10LargestFiles: { path: string; sizeKB: number }[];
}

export interface BundleBudget {
  totalMaxKB: number;
  jsMaxKB: number;
  cssMaxKB: number;
  singleFileMaxKB: number;
  comment: string;
}

export interface BundleHistoryEntry {
  date: string;
  totalKB: number;
  jsKB: number;
  cssKB: number;
  htmlKB: number;
  imgKB: number;
  otherKB: number;
  fileCount: number;
  passed: boolean;
}

export interface BundleCurrent {
  timestamp: string;
  totalKB: number;
  jsKB: number;
  cssKB: number;
  htmlKB: number;
  imgKB: number;
  otherKB: number;
  fileCount: number;
  withinBudget: boolean;
  budget: BundleBudget;
}

// ─── Links ───────────────────────────────────────────────

export interface BrokenLink {
  url: string;
  file: string;
  context: string;
}

export interface LinksBaseline {
  date: string;
  total: number;
  internal: {
    ok: number;
    broken: BrokenLink[];
  };
  external: {
    ok: number;
    broken: BrokenLink[];
  };
}

export interface LinksCurrent {
  date: string;
  total: number;
  internal: { ok: number; broken: number; brokenLinks: BrokenLink[] };
  external: { ok: number; broken: number; brokenLinks: BrokenLink[] };
}

// ─── Dependencies ────────────────────────────────────────

export interface DependencyDetail {
  name: string;
  current: string;
  latest: string;
  status: 'fresh' | 'stale' | 'outdated' | 'deprecated' | 'possiblyUnmaintained';
  lastPublish: string;
  dependencyType: string;
}

export interface DependencyBaseline {
  date: string;
  total: number;
  fresh: number;
  stale: number;
  outdated: number;
  deprecated: number;
  possiblyUnmaintained: number;
  details: DependencyDetail[];
}

export interface DependencyHistoryEntry {
  date: string;
  total: number;
  fresh: number;
  stale: number;
  outdated: number;
  deprecated: number;
  possiblyUnmaintained: number;
}

export interface DependencyCurrent {
  date: string;
  total: number;
  fresh: number;
  stale: number;
  outdated: number;
  deprecated: number;
  possiblyUnmaintained: number;
  details: DependencyDetail[];
}

// ─── Content Velocity ────────────────────────────────────

export interface ContentVelocityReport {
  generatedAt: string;
  referenceDate: string;
  productionSpeed: {
    totalPosts: number;
    weeksActive: number;
    avgPerWeek: number;
    last7Days: number;
    last30Days: number;
    weeklyBreakdown: Record<string, number>;
  };
  typeDistribution: Record<string, {
    count: number;
    pct: number;
    label?: string;
  }>;
  translationDelay: {
    postsWithDelay: number;
    avgDays: number;
    medianDays: number;
    fastest: { ticketId: string; title: string; delay: number; file: string };
    slowest: { ticketId: string; title: string; delay: number; file: string };
    trend: string;
  };
  modelDistribution: { model: string; count: number; pct: number }[];
}

export interface ContentCurrent {
  generatedAt: string;
  totalPosts: number;
  weeklyAvg: number;
  avgDelayDays: number;
  medianDelayDays: number;
  last7Days: number;
  last30Days: number;
  translationTrend: string;
}

// ─── Overview ────────────────────────────────────────────

export interface OverviewScores {
  security: {
    status: 'pass' | 'warn' | 'fail';
    vulns: { critical: number; high: number; moderate: number };
  };
  codeQuality: {
    status: 'pass' | 'warn' | 'fail';
    errors: number;
    warnings: number;
  };
  lighthouse: {
    performance: number;
    accessibility: number;
    bestPractices: number;
    seo: number;
  };
  coverage: {
    statements: number;
    branches: number;
    functions: number;
    lines: number;
  };
  bundle: {
    totalKB: number;
    withinBudget: boolean;
  };
  links: {
    internal: { ok: number; broken: number };
    external: { ok: number; broken: number };
  };
  dependencies: {
    fresh: number;
    stale: number;
    outdated: number;
    deprecated: number;
  };
  content: {
    total: number;
    weeklyAvg: number;
    avgDelayDays: number;
  };
}

export interface OverviewResponse {
  timestamp: string;
  scores: OverviewScores;
  overallHealth: OverallHealth;
}

// ─── Query Params ────────────────────────────────────────

export interface HistoryQueryParams {
  from?: string;
  limit?: number;
}
