#!/usr/bin/env bash
# Regression tests for tribunal shell quota parsing. Static only: no codexbar,
# no Codex/Claude CLI calls, and no tribunal pipeline execution.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# shellcheck source=../tribunal-helpers.sh
source "$ROOT_DIR/scripts/tribunal-helpers.sh"

fail() { echo "x $*" >&2; exit 1; }
pass() { echo "ok $*"; }

sample='== Codex 0.139.0 (oauth) ==
Session: 70% left [========----]
Resets in 12m
Weekly: 64% left [=======-----]
Pace: On pace | Expected 36% used | Runs out in 4d 10h
Resets in 4d 11h
Credits: 0 left
Account: pnk7x9qwyw@privaterelay.appleid.com
Plan: Pro 5x

== Claude 2.1.177 (claude) ==
Session: 4% left [------------]
Resets in 2h 44m
Weekly: 90% left [==========--]
Pace: 6% in deficit | Expected 4% used | Runs out in 2d 8h
Resets in 6d 17h'

codex_block="$(TRIBUNAL_QUOTA_CODEXBAR_OUTPUT="$sample" tribunal_quota_codexbar_block codex)"
parsed="$(tribunal_quota_parse_block "$codex_block")"
IFS='|' read -r session_left session_reset weekly_left weekly_reset <<< "$parsed"

[ "$session_left" = "70" ] || fail "session percent should be 70, got $session_left"
[ "$session_reset" = "720" ] || fail "session reset should be 720s (12m), got $session_reset"
[ "$weekly_left" = "64" ] || fail "weekly percent should be 64, got $weekly_left"
[ "$weekly_reset" = "385200" ] || fail "weekly reset should be 385200s (4d11h), got $weekly_reset"
pass "codexbar multi-line session/weekly reset parser handles real format"

pace_seconds="$(tribunal_quota_seconds_from_text 'Pace: On pace | Expected 36% used | Runs out in 4d 10h')"
if [ "$weekly_reset" = "$pace_seconds" ]; then
  fail "weekly reset used Pace/Runs out duration ($pace_seconds) instead of Resets duration"
fi
pass "Pace/Runs out line is not used as the weekly reset"

decision="$(TRIBUNAL_QUOTA_CODEXBAR_OUTPUT="$sample" GP_QUOTA_MAX_WAIT=6h tribunal_quota_decision codex 0)"
IFS='|' read -r action tier reset_seconds reason <<< "$decision"
[ "$action" = "wait" ] || fail "decision action should be wait, got $action ($decision)"
[ "$tier" = "session" ] || fail "decision tier should be session, got $tier ($decision)"
[ "$reset_seconds" = "720" ] || fail "decision reset should be 720s, got $reset_seconds ($decision)"
case "$reason" in
  *"12m"*) ;;
  *) fail "decision reason should mention 12m, got: $reason" ;;
esac
pass "short session quota decision sleeps until reset"

weekly_exhausted="${sample/Weekly: 64% left/Weekly: 0% left}"
decision="$(TRIBUNAL_QUOTA_CODEXBAR_OUTPUT="$weekly_exhausted" GP_QUOTA_MAX_WAIT=6h tribunal_quota_decision codex 0)"
IFS='|' read -r action tier reset_seconds reason <<< "$decision"
[ "$action" = "suspend" ] || fail "weekly exhausted action should suspend, got $action ($decision)"
[ "$tier" = "weekly" ] || fail "weekly exhausted tier should be weekly, got $tier ($decision)"
[ "$reset_seconds" = "385200" ] || fail "weekly exhausted reset should be 385200s, got $reset_seconds ($decision)"
case "$reason" in
  *"4d 11h"*) ;;
  *) fail "weekly exhausted reason should mention 4d 11h, got: $reason" ;;
esac
pass "weekly quota exhaustion suspends with real reset metadata"
