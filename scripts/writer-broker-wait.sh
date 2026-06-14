#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 --dir <broker_dir> --pid <pipeline_pid> [--timeout <s>]" >&2
}

broker_dir=""
pipeline_pid=""
timeout_sec=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dir)
      broker_dir="${2:-}"
      shift 2
      ;;
    --pid)
      pipeline_pid="${2:-}"
      shift 2
      ;;
    --timeout)
      timeout_sec="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      usage
      exit 2
      ;;
  esac
done

if [ -z "$broker_dir" ] || [ -z "$pipeline_pid" ]; then
  usage
  exit 2
fi

if [ ! -d "$broker_dir" ]; then
  echo "ERROR: broker dir not found: $broker_dir" >&2
  exit 2
fi

broker_dir="$(cd "$broker_dir" && pwd -P)"

pid_alive() {
  kill -0 "$pipeline_pid" >/dev/null 2>&1
}

try_claim_request() {
  local request base id done_marker failed_marker claimed_marker
  for request in "$broker_dir"/*.request.json; do
    [ -e "$request" ] || return 1
    base="$(basename "$request")"
    id="${base%.request.json}"
    done_marker="$broker_dir/$id.done"
    failed_marker="$broker_dir/$id.failed"
    claimed_marker="$broker_dir/$id.claimed"
    if [ -e "$done_marker" ] || [ -e "$failed_marker" ] || [ -e "$claimed_marker" ]; then
      continue
    fi
    if ( set -C; : > "$claimed_marker" ) 2>/dev/null; then
      printf 'REQUEST %s\n' "$request"
      return 0
    fi
  done
  return 1
}

start="$(date +%s)"
while true; do
  if try_claim_request; then
    exit 0
  fi

  if ! pid_alive; then
    if ! compgen -G "$broker_dir/*.request.json" >/dev/null; then
      echo "PIPELINE_DONE"
      exit 0
    fi
  fi

  if [ -n "$timeout_sec" ]; then
    now="$(date +%s)"
    if [ $((now - start)) -ge "$timeout_sec" ]; then
      echo "TIMEOUT"
      exit 1
    fi
  fi

  sleep 1
done
