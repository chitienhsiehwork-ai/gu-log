#!/usr/bin/env bash
# Journal for shell regressions that temporarily rewrite real tracked posts.
# Source it, then call fixture_journal_open while holding the regression's own
# fixture lock.
#
# A run killed with SIGKILL never reaches its EXIT trap and leaves rewritten
# posts behind. fixture_journal_open first restores whatever journal a dead run
# left, then journals this run's originals (each post and its en- sidecar);
# fixture_journal_restore, called from the EXIT trap, puts them back and drops
# the journal. With --recover-fixtures as the flag the script only restores and
# exits: the Vitest wrapper runs that after killing a timed-out run's process
# group, and parses the "recovered <path>" lines.

# fixture_journal_open <journal-dir> <posts-dir> <flag> <post>...
fixture_journal_open() {
  FIXTURE_JOURNAL="$1"
  FIXTURE_JOURNAL_POSTS="$2"
  local flag="$3" name
  shift 3
  FIXTURE_JOURNAL_NAMES=()
  for name in "$@"; do
    FIXTURE_JOURNAL_NAMES+=("$name" "en-$name")
  done
  fixture_journal_restore
  [ "$flag" != --recover-fixtures ] || exit 0
  # Written aside and renamed, so a half-written journal is never restored.
  mkdir -p "$FIXTURE_JOURNAL.tmp"
  for name in "${FIXTURE_JOURNAL_NAMES[@]}"; do
    cp -p "$FIXTURE_JOURNAL_POSTS/$name" "$FIXTURE_JOURNAL.tmp/$name"
  done
  mv "$FIXTURE_JOURNAL.tmp" "$FIXTURE_JOURNAL"
}

fixture_journal_restore() {
  local name post
  rm -rf "$FIXTURE_JOURNAL.tmp"
  [ -d "$FIXTURE_JOURNAL" ] || return 0
  for name in "${FIXTURE_JOURNAL_NAMES[@]}"; do
    post="$FIXTURE_JOURNAL_POSTS/$name"
    [ -f "$FIXTURE_JOURNAL/$name" ] || continue
    [ -f "$post" ] && cmp -s "$FIXTURE_JOURNAL/$name" "$post" && continue
    # A test may have swapped the post for a directory.
    rm -rf "$post"
    cp -p "$FIXTURE_JOURNAL/$name" "$post"
    echo "recovered $post"
  done
  rm -rf "$FIXTURE_JOURNAL"
}
