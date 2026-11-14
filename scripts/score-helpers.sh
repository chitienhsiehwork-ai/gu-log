#!/usr/bin/env bash
set -euo pipefail

SCORE_HELPERS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCORE_ROOT="$(cd "$SCORE_HELPERS_DIR/.." && pwd)"
export SCORE_ROOT

# shellcheck source=scripts/tribunal-helpers.sh
source "$SCORE_ROOT/scripts/tribunal-helpers.sh"

ensure_score_dirs() {
  mkdir -p \
    "$SCORE_ROOT/scores" \
    "$SCORE_ROOT/.score-loop/logs" \
    "$SCORE_ROOT/.score-loop/state" \
    "$SCORE_ROOT/.score-loop/tmp"

  [ -e "$SCORE_ROOT/scores/.gitkeep" ] || : > "$SCORE_ROOT/scores/.gitkeep"
}

tribunal_post_pair_snapshot_create() {
  python3 "$SCORE_ROOT/scripts/tribunal-post-pair-snapshot.py" create "$1"
}

tribunal_post_pair_snapshot_restore() {
  printf '%s' "$2" |
    python3 "$SCORE_ROOT/scripts/tribunal-post-pair-snapshot.py" restore "$1" -
}

tribunal_writer_frontmatter_policy_for_stage() {
  case "${1:-}" in
    factChecker) printf '%s\n' 'paired-summary' ;;
    *) printf '%s\n' 'preserve-all' ;;
  esac
}

tribunal_post_pair_candidate_materialize() {
  printf '%s' "$2" |
    python3 "$SCORE_ROOT/scripts/tribunal-post-pair-snapshot.py" \
      materialize-candidate "$1" -
}

tribunal_post_pair_candidate_capture() {
  local frontmatter_policy="${3:-preserve-all}"
  printf '%s' "$2" |
    python3 "$SCORE_ROOT/scripts/tribunal-post-pair-snapshot.py" \
      capture-candidate --frontmatter-policy "$frontmatter_policy" "$1" -
}

tribunal_post_pair_candidate_apply() {
  local frontmatter_policy="${4:-preserve-all}"
  printf '%s' "$3" |
    python3 "$SCORE_ROOT/scripts/tribunal-post-pair-snapshot.py" \
      apply-candidate --frontmatter-policy "$frontmatter_policy" "$1" "$2" -
}

tribunal_post_pair_candidate_rollback() (
  local post_path="$1"
  local baseline_token="$2"
  local expected_candidate_token="$3"
  local frontmatter_policy="${4:-preserve-all}"
  local rollback_dir rollback_rc=0

  rollback_dir="$(mktemp -d "${TMPDIR:-/tmp}/tribunal-rollback.XXXXXX")" ||
    return 70
  if ! chmod 700 "$rollback_dir"; then
    rmdir -- "$rollback_dir" 2>/dev/null || true
    return 70
  fi

  # Automatic rollback is the inverse of candidate apply: materialize the
  # parent-held baseline into a private directory, then compare-and-swap it
  # over exactly the candidate bytes we previously applied. A human/parallel
  # canonical edit therefore makes apply-candidate fail closed instead of
  # being overwritten. The force restore helper remains operator-only.
  tribunal_post_pair_candidate_materialize \
    "$rollback_dir" "$baseline_token" || rollback_rc=$?
  if [ "$rollback_rc" -eq 0 ]; then
    tribunal_post_pair_candidate_apply \
      "$post_path" "$rollback_dir" "$expected_candidate_token" \
      "$frontmatter_policy" ||
      rollback_rc=$?
  fi
  rm -rf -- "$rollback_dir"
  return "$rollback_rc"
)

tribunal_post_pair_snapshot_persist_recovery() {
  # Worker worktrees are disposable and bootstrap may remove them forcefully.
  # Recovery evidence therefore belongs to the supervisor's durable runtime
  # root whenever one is available.
  local recovery_root="${TRIBUNAL_MAIN_REPO:-$SCORE_ROOT}"
  local recovery_dir="$recovery_root/.score-loop/recovery"
  mkdir -p "$recovery_dir"
  chmod 700 "$recovery_dir"
  printf '%s' "$1" |
    python3 "$SCORE_ROOT/scripts/tribunal-post-pair-snapshot.py" \
      persist-recovery "$recovery_dir" -
}

tribunal_post_pair_snapshot_discard() {
  printf '%s' "$1" |
    python3 "$SCORE_ROOT/scripts/tribunal-post-pair-snapshot.py" discard -
}

# Write score JSON to MDX frontmatter via node helper.
# Also writes to the en-* counterpart if it exists.
write_score_to_frontmatter() (
  local file="$1"
  local judge="$2"
  local score_json="$3"

  # Mirror to en-* counterpart
  local base dir en_file backup_dir zh_backup en_backup
  base="$(basename "$file")"
  dir="$(dirname "$file")"
  en_file="$dir/en-$base"
  backup_dir="$(mktemp -d "${TMPDIR:-/tmp}/tribunal-frontmatter.XXXXXX")" || return 1
  if ! chmod 700 "$backup_dir"; then
    rmdir -- "$backup_dir" 2>/dev/null || true
    return 1
  fi
  zh_backup="$backup_dir/zh"
  en_backup="$backup_dir/en"
  cleanup_frontmatter_backups() {
    local cleanup_rc=0
    rm -f -- "$zh_backup" "$en_backup" || cleanup_rc=1
    rmdir -- "$backup_dir" || cleanup_rc=1
    return "$cleanup_rc"
  }

  if ! cp -- "$file" "$zh_backup"; then
    cleanup_frontmatter_backups || true
    return 1
  fi
  if [ -f "$en_file" ]; then
    if ! cp -- "$en_file" "$en_backup"; then
      cleanup_frontmatter_backups || true
      return 1
    fi
  fi

  local write_rc=0
  node "$SCORE_ROOT/scripts/frontmatter-scores.mjs" write "$file" "$judge" "$score_json" ||
    write_rc=$?
  if [ "$write_rc" -eq 0 ] && [ -f "$en_backup" ]; then
    node "$SCORE_ROOT/scripts/frontmatter-scores.mjs" write "$en_file" "$judge" "$score_json" ||
      write_rc=$?
  fi

  if [ "$write_rc" -ne 0 ]; then
    local restore_rc=0
    cp -- "$zh_backup" "$file" || restore_rc=1
    if [ -f "$en_backup" ]; then
      cp -- "$en_backup" "$en_file" || restore_rc=1
    fi
    if [ "$restore_rc" -ne 0 ]; then
      echo "[write_score] ERROR: failed to restore bilingual frontmatter; recovery snapshots preserved at $backup_dir" >&2
    else
      cleanup_frontmatter_backups || echo "[write_score] WARN: could not remove recovery snapshots at $backup_dir" >&2
    fi
    return 1
  fi

  cleanup_frontmatter_backups ||
    echo "[write_score] WARN: could not remove successful-write snapshots at $backup_dir" >&2
)

normalize_json_file() {
  local json_file="$1"
  [ -f "$json_file" ] || return 1

  python3 - "$json_file" <<'PY'
import json
import re
import sys
from pathlib import Path

path = Path(sys.argv[1])
text = path.read_text(encoding='utf-8')
text = text.strip()
if not text:
    sys.exit(1)

text = re.sub(r'^```(?:json)?\s*', '', text, flags=re.IGNORECASE)
text = re.sub(r'\s*```$', '', text)

decoder = json.JSONDecoder()
for idx, ch in enumerate(text):
    if ch not in '{[':
        continue
    try:
        obj, _ = decoder.raw_decode(text[idx:])
    except Exception:
        continue
    # Schema-normalize common model drift before validation:
    #   scores    → dimensions (Sonnet/Opus sometimes emit this)
    #   composite → score
    #   pass:bool → verdict:"PASS"/"FAIL"
    if isinstance(obj, dict):
        if 'dimensions' not in obj and isinstance(obj.get('scores'), dict):
            obj['dimensions'] = obj.pop('scores')
        if 'score' not in obj and isinstance(obj.get('composite'), (int, float)):
            obj['score'] = int(obj.pop('composite'))
        if 'verdict' not in obj and isinstance(obj.get('pass'), bool):
            obj['verdict'] = 'PASS' if obj['pass'] else 'FAIL'
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    sys.exit(0)

sys.exit(1)
PY
}

validate_judge_score_json() {
  local judge="$1"
  local json_file="$2"
  # Optional 3rd arg: tribunalVersion. Defaults to 8 (legacy) so direct callers
  # and existing tests that pass only <judge> <file> keep the pre-clarity-move
  # schema. tribunal.sh passes $TRIBUNAL_VERSION so v9 runs validate the new
  # ownership (vibe loses clarity, freshEyes gains it).
  local version="${3:-8}"

  [ -f "$json_file" ] || return 1
  normalize_json_file "$json_file" || return 1
  jq empty "$json_file" >/dev/null 2>&1 || return 1

  local score
  score="$(jq -r '.score // empty' "$json_file")"

  [[ "$score" =~ ^[0-9]+$ ]] || return 1
  [ "$score" -ge 0 ] && [ "$score" -le 10 ] || return 1

  # Validate dimensions for each tribunal judge (uniform JSON: { judge, dimensions, score, verdict, reasons })
  local _validate_dim
  _validate_dim() {
    local val
    val="$(jq -r ".dimensions.${1} // empty" "$json_file")"
    [[ "$val" =~ ^[0-9]+$ ]] || return 1
    [ "$val" -ge 0 ] && [ "$val" -le 10 ] || return 1
  }

  case "$judge" in
    librarian)
      _validate_dim glossary    || return 1
      _validate_dim crossRef    || return 1
      _validate_dim sourceAlign || return 1
      _validate_dim attribution || return 1
      ;;
    factCheck|fact-checker)
      _validate_dim accuracy               || return 1
      _validate_dim fidelity               || return 1
      _validate_dim consistency            || return 1
      _validate_dim sourceBoundary         || return 1
      _validate_dim commentarySeparation   || return 1
      ;;
    freshEyes|fresh-eyes)
      _validate_dim readability      || return 1
      _validate_dim firstImpression  || return 1
      _validate_dim payoffDensity    || return 1
      _validate_dim lengthFit        || return 1
      # v9+: clarity moved into Fresh Eyes (non-compensating hard gate).
      if [ "$version" -ge 9 ]; then
        _validate_dim clarity || return 1
      fi
      ;;
    vibe|vibe-opus-scorer)
      _validate_dim persona    || return 1
      _validate_dim moguNote  || return 1
      _validate_dim vibe       || return 1
      # v9+: clarity left Vibe for Fresh Eyes — no longer required here.
      if [ "$version" -lt 9 ]; then
        _validate_dim clarity || return 1
      fi
      _validate_dim narrative  || return 1
      ;;
    *)
      return 1
      ;;
  esac
}
