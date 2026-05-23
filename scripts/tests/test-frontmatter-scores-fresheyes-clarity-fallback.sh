#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

post="$TMP_DIR/post.mdx"
cat > "$post" <<'EOF'
---
title: "Test"
originalDate: "2026-05-23"
translatedDate: "2026-05-23"
source: "x"
sourceUrl: "https://example.com"
summary: "x"
lang: "zh-tw"
scores:
  tribunalVersion: 6
  freshEyes:
    readability: 8
    firstImpression: 9
    score: 8
    date: "2026-05-23"
    model: "gpt-5.5"
  vibe:
    persona: 8
    clawdNote: 8
    vibe: 8
    clarity: 7
    narrative: 8
    score: 7
    date: "2026-05-23"
    model: "gpt-5.5"
---
body
EOF

got="$(node "$ROOT_DIR/scripts/frontmatter-scores.mjs" get "$post" freshEyes)"
if [[ "$got" != *'"clarity":7'* ]]; then
  echo "expected legacy vibe.clarity to be exposed via freshEyes get"
  echo "$got"
  exit 1
fi

echo "PASS: freshEyes get falls back to legacy vibe.clarity"
