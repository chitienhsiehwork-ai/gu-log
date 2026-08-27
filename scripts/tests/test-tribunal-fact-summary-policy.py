#!/usr/bin/env python3
"""Regression tests for FactChecker-scoped summary candidate transactions."""

from __future__ import annotations

import importlib.util
import os
import pathlib
import signal
import subprocess
import sys
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "scripts" / "tribunal-post-pair-snapshot.py"
SPEC = importlib.util.spec_from_file_location("tribunal_snapshot_summary", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("could not load Tribunal snapshot helper")
SNAPSHOT = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = SNAPSHOT
SPEC.loader.exec_module(SNAPSHOT)

PRESERVE_ALL = "preserve-all"
PAIRED_SUMMARY = "paired-summary"


def post(frontmatter_lines: list[bytes], body: bytes, eol: bytes = b"\n") -> bytes:
    return eol.join([b"---", *frontmatter_lines, b"---", body]) + eol


class SummaryPolicyFixture(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(
            prefix="tribunal-summary-policy-", dir=os.environ.get("TMPDIR") or "/tmp"
        )
        self.root = pathlib.Path(self.temp.name)
        self.posts = self.root / "posts"
        self.candidate = self.root / "candidate"
        self.posts.mkdir()
        self.candidate.mkdir()
        self.candidate.chmod(0o700)
        self.zh_path = self.posts / "pair.mdx"
        self.en_path = self.posts / "en-pair.mdx"
        self.tokens: list[str] = []

    def tearDown(self) -> None:
        for token in self.tokens:
            try:
                SNAPSHOT.discard_snapshot(token)
            except (OSError, SNAPSHOT.SnapshotError):
                pass
        self.temp.cleanup()

    def prepare(
        self, baseline_zh: bytes, baseline_en: bytes | None = None
    ) -> str:
        for child in self.candidate.iterdir():
            child.unlink()
        for path in (self.zh_path, self.en_path):
            if path.exists():
                path.unlink()
        self.zh_path.write_bytes(baseline_zh)
        self.zh_path.chmod(0o640)
        if baseline_en is not None:
            self.en_path.write_bytes(baseline_en)
            self.en_path.chmod(0o604)
        token = SNAPSHOT.create_snapshot(str(self.zh_path))
        self.tokens.append(token)
        SNAPSHOT.materialize_candidate(str(self.candidate), token)
        return token

    def capture(self, token: str, policy: str = PAIRED_SUMMARY) -> str:
        captured = SNAPSHOT.capture_candidate(
            str(self.candidate),
            token,
            frontmatter_policy=policy,
        )
        self.tokens.append(captured)
        return captured

    def apply(self, token: str, policy: str = PAIRED_SUMMARY) -> None:
        SNAPSHOT.apply_candidate(
            str(self.zh_path),
            str(self.candidate),
            token,
            frontmatter_policy=policy,
        )


class SummaryShapeTests(SummaryPolicyFixture):
    def test_accepts_supported_quoted_scalars_without_normalizing_bytes(self) -> None:
        cases = [
            (
                "double quote escape and inline comment",
                post(
                    [
                        b'title: "Exact bytes"',
                        b'summary: "He said \\"old\\""  # keep this comment',
                    ],
                    b"baseline zh",
                ),
                post(
                    [
                        b'title: "Exact bytes"',
                        b'summary: "He said \\"new\\""  # keep this comment',
                    ],
                    b"candidate zh",
                ),
            ),
            (
                "single quote doubled quote",
                post(
                    [b"title: 'Exact bytes'", b"summary: 'It''s old'"],
                    b"baseline zh",
                ),
                post(
                    [b"title: 'Exact bytes'", b"summary: 'It''s new'"],
                    b"candidate zh",
                ),
            ),
            (
                "CRLF",
                post(
                    [b'title: "Exact bytes"', b'summary: "old" # comment'],
                    b"baseline zh",
                    b"\r\n",
                ),
                post(
                    [b'title: "Exact bytes"', b'summary: "new" # comment'],
                    b"candidate zh",
                    b"\r\n",
                ),
            ),
            (
                "plain top-level keys with nested values",
                post(
                    [
                        b'# retained comment',
                        b'title: "Exact bytes"',
                        b"scores:",
                        b"  factCheck:",
                        b"    accuracy: 9",
                        b'summary: "old"',
                    ],
                    b"baseline zh",
                ),
                post(
                    [
                        b'# retained comment',
                        b'title: "Exact bytes"',
                        b"scores:",
                        b"  factCheck:",
                        b"    accuracy: 9",
                        b'summary: "new"',
                    ],
                    b"candidate zh",
                ),
            ),
            (
                "double quote Unicode scalar boundaries and controls",
                post(
                    [
                        b'title: "Exact bytes"',
                        b'summary: "old \\uD7FF \\uE000 \\U0010FFFF \\0 \\x1F"',
                    ],
                    b"baseline zh",
                ),
                post(
                    [
                        b'title: "Exact bytes"',
                        b'summary: "new \\uD7FF \\uE000 \\U0010FFFF \\0 \\x1F"',
                    ],
                    b"candidate zh",
                ),
            ),
        ]
        for label, baseline, candidate in cases:
            with self.subTest(label=label):
                baseline_en = baseline.replace(b"baseline zh", b"baseline en")
                candidate_en = candidate.replace(b"candidate zh", b"candidate en")
                token = self.prepare(baseline, baseline_en)
                (self.candidate / "pair.mdx").write_bytes(candidate)
                (self.candidate / "en-pair.mdx").write_bytes(candidate_en)
                self.capture(token)

                self.assertEqual(self.zh_path.read_bytes(), baseline)
                self.assertEqual(self.en_path.read_bytes(), baseline_en)

                for child in self.candidate.iterdir():
                    child.unlink()
                self.en_path.unlink()
                self.zh_path.unlink()

    def test_rejects_non_scalar_double_quote_escapes_without_changing_canonical(
        self,
    ) -> None:
        cases = {
            "above Unicode maximum": b'summary: "bad \\U00110000"',
            "short high surrogate": b'summary: "bad \\uD800"',
            "short low surrogate": b'summary: "bad \\uDFFF"',
            "long high surrogate": b'summary: "bad \\U0000D800"',
            "long low surrogate": b'summary: "bad \\U0000DFFF"',
        }
        for label, candidate_summary in cases.items():
            with self.subTest(label=label):
                baseline = post([b'summary: "old"'], b"baseline")
                token = self.prepare(baseline)
                (self.candidate / "pair.mdx").write_bytes(
                    post([candidate_summary], b"candidate")
                )
                with self.assertRaisesRegex(
                    SNAPSHOT.SnapshotError, "invalid Unicode scalar escape"
                ):
                    self.capture(token)
                self.assertEqual(self.zh_path.read_bytes(), baseline)
                (self.candidate / "pair.mdx").unlink()
                self.zh_path.unlink()

    def test_rejects_unsupported_summary_shapes_with_distinct_diagnostic(self) -> None:
        cases = {
            "duplicate": (
                [b'summary: "old"', b'summary: "shadow"'],
                [b'summary: "new"', b'summary: "shadow"'],
            ),
            "double-quoted duplicate key": (
                [b'summary: "old"', b'"summary": "shadow"'],
                [b'summary: "new"', b'"summary": "shadow"'],
            ),
            "single-quoted duplicate key": (
                [b'summary: "old"', b"'summary': \"shadow\""],
                [b'summary: "new"', b"'summary': \"shadow\""],
            ),
            "explicit duplicate key": (
                [b'summary: "old"', b'? summary', b': "shadow"'],
                [b'summary: "new"', b'? summary', b': "shadow"'],
            ),
            "explicit quoted duplicate key": (
                [b'summary: "old"', b'? "summary"', b': "shadow"'],
                [b'summary: "new"', b'? "summary"', b': "shadow"'],
            ),
            "escaped quoted duplicate key": (
                [b'summary: "old"', b'"summ\\u0061ry": "shadow"'],
                [b'summary: "new"', b'"summ\\u0061ry": "shadow"'],
            ),
            "tagged duplicate key": (
                [b'summary: "old"', b'!!str summary: "shadow"'],
                [b'summary: "new"', b'!!str summary: "shadow"'],
            ),
            "anchored duplicate key": (
                [b'summary: "old"', b'&k summary: "shadow"'],
                [b'summary: "new"', b'&k summary: "shadow"'],
            ),
            "explicit tagged duplicate key": (
                [b'summary: "old"', b'? !!str summary', b': "shadow"'],
                [b'summary: "new"', b'? !!str summary', b': "shadow"'],
            ),
            "explicit anchored duplicate key": (
                [b'summary: "old"', b'? &k summary', b': "shadow"'],
                [b'summary: "new"', b'? &k summary', b': "shadow"'],
            ),
            "block scalar": (
                [b"summary: |", b"  old"],
                [b"summary: |", b"  new"],
            ),
            "folded scalar": (
                [b"summary: >", b"  old"],
                [b"summary: >", b"  new"],
            ),
            "tag": (
                [b'summary: !!str "old"'],
                [b'summary: !!str "new"'],
            ),
            "anchor": (
                [b'summary: &copy "old"'],
                [b'summary: &copy "new"'],
            ),
            "alias": ([b"summary: *copy"], [b"summary: *other"]),
            "plain": ([b"summary: old"], [b"summary: new"]),
            "multiline double quote": (
                [b'summary: "old', b'  continued"'],
                [b'summary: "new', b'  continued"'],
            ),
            "multiline single quote": (
                [b"summary: 'old", b"  continued'"],
                [b"summary: 'new", b"  continued'"],
            ),
            "malformed double escape": (
                [b'summary: "old"'],
                [b'summary: "bad \\q escape"'],
            ),
        }
        for label, (baseline_lines, candidate_lines) in cases.items():
            with self.subTest(label=label):
                baseline = post(baseline_lines, b"baseline")
                token = self.prepare(baseline)
                (self.candidate / "pair.mdx").write_bytes(
                    post(candidate_lines, b"candidate")
                )
                with self.assertRaisesRegex(
                    SNAPSHOT.SnapshotError, "unsupported zh-tw summary shape"
                ):
                    self.capture(token)
                self.assertEqual(self.zh_path.read_bytes(), baseline)
                (self.candidate / "pair.mdx").unlink()
                self.zh_path.unlink()

    def test_rejects_non_plain_top_level_keys_even_when_not_summary(self) -> None:
        cases = {
            "escaped quoted key": [b'"t\\u0069tle": "Protected"'],
            "tagged key": [b'!!str title: "Protected"'],
            "anchored key": [b'&k title: "Protected"'],
            "explicit tagged key": [b'? !!str title', b': "Protected"'],
            "explicit anchored key": [b'? &k title', b': "Protected"'],
        }
        for label, exotic_lines in cases.items():
            with self.subTest(label=label):
                baseline = post(
                    [*exotic_lines, b'summary: "old"'], b"baseline"
                )
                candidate = post(
                    [*exotic_lines, b'summary: "new"'], b"candidate"
                )
                token = self.prepare(baseline)
                (self.candidate / "pair.mdx").write_bytes(candidate)
                with self.assertRaisesRegex(
                    SNAPSHOT.SnapshotError, "unsupported zh-tw summary shape"
                ):
                    self.capture(token)
                self.assertEqual(self.zh_path.read_bytes(), baseline)
                (self.candidate / "pair.mdx").unlink()
                self.zh_path.unlink()

    def test_rejects_every_non_payload_frontmatter_change(self) -> None:
        baseline = post(
            [b'title: "Protected"', b'summary: "old" # exact', b"draft: false"],
            b"baseline",
        )
        mutations = {
            "other field": post(
                [b'title: "Changed"', b'summary: "new" # exact', b"draft: false"],
                b"candidate",
            ),
            "position": post(
                [b'summary: "new" # exact', b'title: "Protected"', b"draft: false"],
                b"candidate",
            ),
            "quote style": post(
                [b'title: "Protected"', b"summary: 'new' # exact", b"draft: false"],
                b"candidate",
            ),
            "line ending": post(
                [b'title: "Protected"', b'summary: "new" # exact', b"draft: false"],
                b"candidate",
                b"\r\n",
            ),
        }
        for label, candidate in mutations.items():
            with self.subTest(label=label):
                token = self.prepare(baseline)
                (self.candidate / "pair.mdx").write_bytes(candidate)
                with self.assertRaises(SNAPSHOT.SnapshotError):
                    self.capture(token)
                (self.candidate / "pair.mdx").unlink()
                self.zh_path.unlink()

    def test_rejects_partial_bilingual_summary_change(self) -> None:
        baseline_zh = post([b'summary: "old zh"'], b"baseline zh")
        baseline_en = post([b'summary: "old en"'], b"baseline en")
        token = self.prepare(baseline_zh, baseline_en)
        (self.candidate / "pair.mdx").write_bytes(
            post([b'summary: "new zh"'], b"candidate zh")
        )
        (self.candidate / "en-pair.mdx").write_bytes(
            post([b'summary: "old en"'], b"candidate en")
        )
        with self.assertRaisesRegex(
            SNAPSHOT.SnapshotError, "both zh-tw and English summaries"
        ):
            self.capture(token)

    def test_preserve_all_remains_the_default(self) -> None:
        baseline = post([b'summary: "old"'], b"baseline")
        token = self.prepare(baseline)
        (self.candidate / "pair.mdx").write_bytes(
            post([b'summary: "new"'], b"candidate")
        )
        with self.assertRaisesRegex(
            SNAPSHOT.SnapshotError, "protected zh-tw frontmatter"
        ):
            SNAPSHOT.capture_candidate(str(self.candidate), token)


@unittest.skipUnless(sys.platform.startswith("linux"), "renameat2 requires Linux")
class SummaryTransactionTests(SummaryPolicyFixture):
    def test_applies_and_reverse_rolls_back_a_bilingual_summary_pair(self) -> None:
        baseline_zh = post([b'summary: "old zh"'], b"baseline zh")
        baseline_en = post([b"summary: 'old en'"], b"baseline en")
        candidate_zh = post([b'summary: "new zh"'], b"candidate zh")
        candidate_en = post([b"summary: 'new en'"], b"candidate en")
        baseline_token = self.prepare(baseline_zh, baseline_en)
        (self.candidate / "pair.mdx").write_bytes(candidate_zh)
        (self.candidate / "en-pair.mdx").write_bytes(candidate_en)
        candidate_token = self.capture(baseline_token)

        self.apply(baseline_token)
        self.assertEqual(self.zh_path.read_bytes(), candidate_zh)
        self.assertEqual(self.en_path.read_bytes(), candidate_en)
        self.assertEqual(self.zh_path.stat().st_mode & 0o777, 0o640)
        self.assertEqual(self.en_path.stat().st_mode & 0o777, 0o604)

        for child in self.candidate.iterdir():
            child.unlink()
        SNAPSHOT.materialize_candidate(str(self.candidate), baseline_token)
        self.apply(candidate_token)
        self.assertEqual(self.zh_path.read_bytes(), baseline_zh)
        self.assertEqual(self.en_path.read_bytes(), baseline_en)

    def test_applies_a_monolingual_summary_without_creating_english(self) -> None:
        baseline = post([b'summary: "old"'], b"baseline")
        candidate = post([b'summary: "new"'], b"candidate")
        token = self.prepare(baseline)
        (self.candidate / "pair.mdx").write_bytes(candidate)
        self.capture(token)
        self.apply(token)
        self.assertEqual(self.zh_path.read_bytes(), candidate)
        self.assertFalse(self.en_path.exists())

    def test_parallel_edit_is_preserved_before_summary_apply(self) -> None:
        baseline_zh = post([b'summary: "old zh"'], b"baseline zh")
        baseline_en = post([b'summary: "old en"'], b"baseline en")
        token = self.prepare(baseline_zh, baseline_en)
        (self.candidate / "pair.mdx").write_bytes(
            post([b'summary: "new zh"'], b"candidate zh")
        )
        (self.candidate / "en-pair.mdx").write_bytes(
            post([b'summary: "new en"'], b"candidate en")
        )
        human = post([b'summary: "human zh"'], b"parallel human edit")
        self.zh_path.write_bytes(human)

        with self.assertRaises(SNAPSHOT.SnapshotError):
            self.apply(token)
        self.assertEqual(self.zh_path.read_bytes(), human)
        self.assertEqual(self.en_path.read_bytes(), baseline_en)

    def test_sigkill_recovery_is_policy_neutral_for_summary_pair(self) -> None:
        baseline_zh = post([b'summary: "old zh"'], b"baseline zh")
        baseline_en = post([b'summary: "old en"'], b"baseline en")
        candidate_zh = post([b'summary: "new zh"'], b"candidate zh")
        candidate_en = post([b'summary: "new en"'], b"candidate en")
        token = self.prepare(baseline_zh, baseline_en)
        (self.candidate / "pair.mdx").write_bytes(candidate_zh)
        (self.candidate / "en-pair.mdx").write_bytes(candidate_en)
        token_path = self.root / "token.json"
        token_path.write_text(token, encoding="utf-8")
        child = r'''
import importlib.util
import os
import pathlib
import signal
import sys

spec = importlib.util.spec_from_file_location("summary_killed_apply", sys.argv[1])
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
original = module._rename_exchange

def kill_after_first_exchange(directory_fd, first_name, second_name):
    original(directory_fd, first_name, second_name)
    os.kill(os.getpid(), signal.SIGKILL)

module._rename_exchange = kill_after_first_exchange
module.apply_candidate(
    sys.argv[2],
    sys.argv[3],
    pathlib.Path(sys.argv[4]).read_text(encoding="utf-8"),
    frontmatter_policy="paired-summary",
)
'''
        killed = subprocess.run(
            [
                sys.executable,
                "-c",
                child,
                str(MODULE_PATH),
                str(self.zh_path),
                str(self.candidate),
                str(token_path),
            ],
            check=False,
        )
        self.assertEqual(killed.returncode, -signal.SIGKILL)

        recovered = SNAPSHOT.recover_pending(str(self.posts))
        self.assertEqual(recovered, 1)
        final_pair = (self.zh_path.read_bytes(), self.en_path.read_bytes())
        self.assertIn(
            final_pair,
            {
                (baseline_zh, baseline_en),
                (candidate_zh, candidate_en),
            },
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
