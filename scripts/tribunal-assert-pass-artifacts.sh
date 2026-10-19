#!/usr/bin/env bash
# tribunal-assert-pass-artifacts.sh — fail if a Tribunal PASS commit/stage has
# only progress JSON and no target post artifacts.

set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage:
  tribunal-assert-pass-artifacts.sh <repo> <post_file.mdx> --staged
  tribunal-assert-pass-artifacts.sh <repo> <post_file.mdx> --commit <sha>
USAGE
}

repo="${1:-}"
post_file="${2:-}"
mode="${3:-}"
commit_sha="${4:-}"
required_tribunal_version="${TRIBUNAL_REQUIRED_VERSION:-8}"

if [ -z "$repo" ] || [ -z "$post_file" ] || [ -z "$mode" ]; then
  usage
  exit 2
fi

repo="$(cd "$repo" && pwd -P)"
post_file="$(basename "$post_file")"
case "$post_file" in
  *.mdx) ;;
  *) echo "ERROR: post_file must be an .mdx basename: $post_file" >&2; exit 2 ;;
esac
case "$post_file" in
  en-*) echo "ERROR: post_file must be the zh-tw canonical post, not en-* ($post_file)" >&2; exit 2 ;;
esac

zh_rel="src/content/posts/$post_file"
en_rel="src/content/posts/en-$post_file"

changed_files() {
  case "$mode" in
    --staged)
      git -C "$repo" diff --cached --name-only --no-renames --diff-filter=ACMRD
      ;;
    --commit)
      if [ -z "$commit_sha" ]; then
        usage
        exit 2
      fi
      git -C "$repo" diff-tree --no-commit-id --name-only --no-renames -r "$commit_sha"
      ;;
    *)
      usage
      exit 2
      ;;
  esac
}

has_changed_file() {
  local needle="$1"
  changed_files | grep -Fxq "$needle"
}

read_file_at_check_target() {
  local rel="$1"
  case "$mode" in
    --staged)
      if ! git -C "$repo" show ":$rel" 2>/dev/null; then
        echo "ERROR: unable to read staged target post artifact from index: $rel" >&2
        return 1
      fi
      ;;
    --commit)
      if ! git -C "$repo" show "$commit_sha:$rel" 2>/dev/null; then
        echo "ERROR: unable to read committed target post artifact: $rel" >&2
        return 1
      fi
      ;;
  esac
}

if ! has_changed_file "$zh_rel"; then
  echo "ERROR: missing staged target post artifact for Tribunal PASS: $zh_rel" >&2
  echo "       Refusing progress-only Tribunal PASS commit." >&2
  exit 1
fi

# If the EN counterpart exists in the target tree or is changed in this commit,
# require it to be staged/committed too. Some zh-tw-first posts legitimately do
# not have EN yet, so absence is not fatal.
en_exists=0
case "$mode" in
  --staged)
    if git -C "$repo" cat-file -e ":$en_rel" 2>/dev/null || has_changed_file "$en_rel"; then
      en_exists=1
    fi
    ;;
  --commit)
    if git -C "$repo" cat-file -e "$commit_sha:$en_rel" 2>/dev/null || has_changed_file "$en_rel"; then
      en_exists=1
    fi
    ;;
esac
if [ "$en_exists" -eq 1 ] && ! has_changed_file "$en_rel"; then
  echo "ERROR: missing staged EN target post artifact for Tribunal PASS: $en_rel" >&2
  echo "       Refusing partial/progress-only Tribunal PASS commit." >&2
  exit 1
fi

has_required_score_frontmatter() {
  local content="$1"
  grep -q '^scores:' <<<"$content" || return 1
  local version
  version="$(awk '/tribunalVersion:/ {print $2; exit}' <<<"$content" | tr -d '"')"
  [[ "$version" =~ ^[0-9]+$ ]] || return 1
  [ "$version" -ge "$required_tribunal_version" ]
}

missing_required_judges() {
  local content="$1"
  local missing=()
  local judge
  for judge in librarian factCheck freshEyes vibe; do
    if ! grep -q "^  ${judge}:$" <<<"$content"; then
      missing+=("$judge")
    fi
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    printf '%s\n' "${missing[@]}"
  fi
}

extract_first_frontmatter() {
  awk '
    NR == 1 {
      if ($0 != "---") exit 2
      next
    }
    $0 == "---" {
      closed = 1
      exit
    }
    { print }
    END {
      if (!closed) exit 2
    }
  '
}

assert_complete_score_frontmatter() {
  local rel="$1"
  local content="$2"
  local frontmatter
  if ! frontmatter="$(extract_first_frontmatter <<<"$content")"; then
    echo "ERROR: target post artifact lacks a complete first frontmatter block: $rel" >&2
    echo "       Refusing Tribunal PASS without parseable published frontmatter." >&2
    return 1
  fi

  if ! has_required_score_frontmatter "$frontmatter"; then
    echo "ERROR: target post artifact lacks scores.tribunalVersion >= $required_tribunal_version: $rel" >&2
    echo "       Refusing Tribunal PASS without published score frontmatter." >&2
    return 1
  fi

  local missing
  missing="$(missing_required_judges "$frontmatter")"
  if [ -n "$missing" ]; then
    echo "ERROR: target post artifact has incomplete Tribunal v${required_tribunal_version}+ scores: $rel" >&2
    echo "       Missing judge block(s): $(tr '\n' ' ' <<<"$missing" | sed 's/[[:space:]]*$//')" >&2
    echo "       Refusing Tribunal PASS until librarian + factCheck + freshEyes + vibe are all present." >&2
    return 1
  fi
}

zh_content="$(read_file_at_check_target "$zh_rel")"
assert_complete_score_frontmatter "$zh_rel" "$zh_content"

if [ "$en_exists" -eq 1 ]; then
  en_content="$(read_file_at_check_target "$en_rel")"
  assert_complete_score_frontmatter "$en_rel" "$en_content"
fi

exit 0
