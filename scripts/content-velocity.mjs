#!/usr/bin/env node

/**
 * Content Velocity Report (SQAA Level 8)
 *
 * Scans all non-English MDX posts, extracts frontmatter metrics,
 * and produces a comprehensive content velocity analysis.
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, basename } from 'node:path';

const POSTS_DIR = join(import.meta.dirname, '..', 'src', 'content', 'posts');
const OUTPUT_DIR = join(import.meta.dirname, '..', 'quality');
const OUTPUT_FILE = join(OUTPUT_DIR, 'content-velocity-report.json');

// ── Helpers ──────────────────────────────────────────────────

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const raw = match[1];
  const fm = {};

  for (const line of raw.split('\n')) {
    // Handle top-level keys (simple scalars)
    const kvMatch = line.match(/^(\w[\w.-]*):\s*(.+)/);
    if (kvMatch) {
      let [, key, value] = kvMatch;
      // Strip quotes
      value = value.replace(/^["']|["']$/g, '').trim();
      fm[key] = value;
    }
    // Handle nested keys like translatedBy.model
    const nestedMatch = line.match(/^\s{2}(\w+):\s*(.+)/);
    if (nestedMatch) {
      let [, key, value] = nestedMatch;
      value = value.replace(/^["']|["']$/g, '').trim();
      // Attach to parent (last top-level key that had no value)
      if (!fm._nested) fm._nested = {};
      fm._nested[key] = value;
    }
  }

  // Parse tags array
  const tagsMatch = raw.match(/tags:\s*\[([^\]]*)\]/);
  if (tagsMatch) {
    fm.tags = tagsMatch[1]
      .split(',')
      .map(t => t.trim().replace(/^["']|["']$/g, ''));
  }

  return fm;
}

function daysBetween(dateA, dateB) {
  const a = new Date(dateA);
  const b = new Date(dateB);
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

function isoWeek(dateStr) {
  const d = new Date(dateStr);
  const year = d.getFullYear();
  // Get ISO week number
  const jan1 = new Date(year, 0, 1);
  const dayOfYear = Math.ceil((d - jan1) / (1000 * 60 * 60 * 24)) + 1;
  const week = Math.ceil(dayOfYear / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  const files = (await readdir(POSTS_DIR))
    .filter(f => f.endsWith('.mdx') && !f.startsWith('en-'));

  const posts = [];

  for (const file of files) {
    const content = await readFile(join(POSTS_DIR, file), 'utf-8');
    const fm = parseFrontmatter(content);
    if (!fm) continue;

    const ticketId = fm.ticketId || null;
    const title = fm.title || basename(file, '.mdx');
    const originalDate = fm.originalDate || null;
    const translatedDate = fm.translatedDate || fm.date || null;
    const tags = fm.tags || [];
    const model = fm._nested?.model || null;

    posts.push({
      file,
      ticketId,
      title,
      originalDate,
      translatedDate,
      tags,
      model,
    });
  }

  // ── Production Speed ───────────────────────────────────────

  const totalPosts = posts.length;

  // Group by week (using translatedDate)
  const weeklyGroups = {};
  const now = new Date('2026-02-12'); // Current date

  for (const p of posts) {
    if (!p.translatedDate) continue;
    const week = isoWeek(p.translatedDate);
    weeklyGroups[week] = (weeklyGroups[week] || 0) + 1;
  }

  const weekCount = Object.keys(weeklyGroups).length;
  const avgPerWeek = weekCount ? +(totalPosts / weekCount).toFixed(2) : 0;

  // Recent counts
  const last7 = posts.filter(p => {
    if (!p.translatedDate) return false;
    return daysBetween(p.translatedDate, now.toISOString().slice(0, 10)) <= 7 &&
           daysBetween(p.translatedDate, now.toISOString().slice(0, 10)) >= 0;
  }).length;

  const last30 = posts.filter(p => {
    if (!p.translatedDate) return false;
    return daysBetween(p.translatedDate, now.toISOString().slice(0, 10)) <= 30 &&
           daysBetween(p.translatedDate, now.toISOString().slice(0, 10)) >= 0;
  }).length;

  // ── Type Distribution ──────────────────────────────────────

  const typeCount = { SP: 0, CP: 0, SD: 0, unknown: 0 };

  for (const p of posts) {
    if (!p.ticketId) { typeCount.unknown++; continue; }
    const prefix = p.ticketId.split('-')[0];
    if (prefix in typeCount) typeCount[prefix]++;
    else typeCount.unknown++;
  }

  const typeDistribution = {
    SP: { count: typeCount.SP, pct: +((typeCount.SP / totalPosts) * 100).toFixed(1), label: 'ShroomDog Picks' },
    CP: { count: typeCount.CP, pct: +((typeCount.CP / totalPosts) * 100).toFixed(1), label: 'Clawd Picks' },
    SD: { count: typeCount.SD, pct: +((typeCount.SD / totalPosts) * 100).toFixed(1), label: 'ShroomDog Original' },
    unknown: { count: typeCount.unknown, pct: +((typeCount.unknown / totalPosts) * 100).toFixed(1) },
  };

  // ── Translation Delay ──────────────────────────────────────

  const delays = [];
  for (const p of posts) {
    if (!p.originalDate || !p.translatedDate) continue;
    const delay = daysBetween(p.originalDate, p.translatedDate);
    delays.push({ ...p, delay });
  }

  delays.sort((a, b) => a.delay - b.delay);

  const delayValues = delays.map(d => d.delay);
  const avgDelay = delayValues.length
    ? +(delayValues.reduce((s, v) => s + v, 0) / delayValues.length).toFixed(1)
    : 0;
  const medianDelay = median(delayValues);

  const fastest = delays.length ? delays[0] : null;
  const slowest = delays.length ? delays[delays.length - 1] : null;

  // Trend: compare first half average to second half average
  let delayTrend = 'insufficient data';
  if (delays.length >= 4) {
    // Sort by translatedDate to see temporal trend
    const byDate = [...delays].sort((a, b) =>
      new Date(a.translatedDate) - new Date(b.translatedDate)
    );
    const mid = Math.floor(byDate.length / 2);
    const firstHalf = byDate.slice(0, mid).map(d => d.delay);
    const secondHalf = byDate.slice(mid).map(d => d.delay);
    const avgFirst = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;
    if (avgSecond < avgFirst - 1) delayTrend = 'improving (getting faster)';
    else if (avgSecond > avgFirst + 1) delayTrend = 'slowing down';
    else delayTrend = 'stable';
  }

  // ── Model Distribution ─────────────────────────────────────

  const modelCounts = {};
  for (const p of posts) {
    const m = p.model || 'unknown';
    modelCounts[m] = (modelCounts[m] || 0) + 1;
  }

  const modelDistribution = Object.entries(modelCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([model, count]) => ({
      model,
      count,
      pct: +((count / totalPosts) * 100).toFixed(1),
    }));

  // ── Build Report ───────────────────────────────────────────

  const report = {
    generatedAt: new Date().toISOString(),
    referenceDate: '2026-02-12',
    productionSpeed: {
      totalPosts,
      weeksActive: weekCount,
      avgPerWeek,
      last7Days: last7,
      last30Days: last30,
      weeklyBreakdown: weeklyGroups,
    },
    typeDistribution,
    translationDelay: {
      postsWithDelay: delays.length,
      avgDays: avgDelay,
      medianDays: medianDelay,
      fastest: fastest
        ? { ticketId: fastest.ticketId, title: fastest.title, delay: fastest.delay, file: fastest.file }
        : null,
      slowest: slowest
        ? { ticketId: slowest.ticketId, title: slowest.title, delay: slowest.delay, file: slowest.file }
        : null,
      trend: delayTrend,
    },
    modelDistribution,
  };

  // ── Output ─────────────────────────────────────────────────

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(OUTPUT_FILE, JSON.stringify(report, null, 2) + '\n');
  console.log(`\n📊 Content Velocity Report saved to: quality/content-velocity-report.json\n`);

  // Human-readable summary
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  📈 CONTENT VELOCITY REPORT — gu-log');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log(`📝 Total posts: ${totalPosts}`);
  console.log(`📅 Weeks active: ${weekCount}`);
  console.log(`⚡ Average output: ${avgPerWeek} posts/week`);
  console.log(`🔥 Last 7 days: ${last7} posts`);
  console.log(`📆 Last 30 days: ${last30} posts\n`);

  console.log('── Type Distribution ──────────────────────────────────');
  console.log(`  SP (ShroomDog Picks):    ${typeCount.SP} (${typeDistribution.SP.pct}%)`);
  console.log(`  CP (Clawd Picks):        ${typeCount.CP} (${typeDistribution.CP.pct}%)`);
  console.log(`  SD (ShroomDog Original): ${typeCount.SD} (${typeDistribution.SD.pct}%)`);
  if (typeCount.unknown > 0) {
    console.log(`  Unknown:                 ${typeCount.unknown} (${typeDistribution.unknown.pct}%)`);
  }
  console.log('');

  console.log('── Translation Delay ─────────────────────────────────');
  console.log(`  Posts with delay data: ${delays.length}`);
  console.log(`  Average delay:  ${avgDelay} days`);
  console.log(`  Median delay:   ${medianDelay} days`);
  if (fastest) console.log(`  ⚡ Fastest: ${fastest.delay} day(s) — [${fastest.ticketId}] ${fastest.title}`);
  if (slowest) console.log(`  🐢 Slowest: ${slowest.delay} day(s) — [${slowest.ticketId}] ${slowest.title}`);
  console.log(`  📉 Trend: ${delayTrend}`);
  console.log('');

  console.log('── Model Usage ───────────────────────────────────────');
  for (const m of modelDistribution) {
    const bar = '█'.repeat(Math.max(1, Math.round(m.pct / 3)));
    console.log(`  ${m.model.padEnd(20)} ${String(m.count).padStart(3)} (${String(m.pct).padStart(5)}%) ${bar}`);
  }
  console.log('\n═══════════════════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
