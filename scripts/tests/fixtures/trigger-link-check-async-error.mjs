#!/usr/bin/env node
// Test fixture for scripts/tests/test-check-links-error-handling.sh.
//
// Importing check-links.mjs registers its process-level uncaughtException/
// unhandledRejection handlers as a side effect but does NOT run main() (see
// the import.meta.url guard at the bottom of that file) — so this fixture
// gets the real handler wiring without needing a dist/ build or posts dir.
//
// Usage: node trigger-link-check-async-error.mjs <known|unknown> <exception|rejection>
import '../../check-links.mjs';

const shape = process.argv[2];
const via = process.argv[3];

function makeKnownUndiciSocketError() {
  const err = new Error('other side closed');
  err.name = 'SocketError';
  err.code = 'UND_ERR_SOCKET';
  return err;
}

function makeUnknownError() {
  const err = new TypeError('something unrelated broke');
  return err;
}

const err = shape === 'known' ? makeKnownUndiciSocketError() : makeUnknownError();

if (via === 'rejection') {
  Promise.reject(err);
} else {
  process.nextTick(() => {
    throw err;
  });
}

// Only reachable if the handler tolerated the error instead of exiting —
// i.e. only for the "known" shape. The test harness checks for this marker
// plus this process's own exit code.
setTimeout(() => {
  console.log('FIXTURE_SURVIVED');
  process.exit(0);
}, 200);
