package pipeline

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/config"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/llm"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/logx"
)

// A GP body passes the content checks before the source-distance stamp:
// refine gets back what they flag, and a body that still fails is neither
// paired nor stamped. The checks are stubs here; the real scripts are covered
// by tests/content-gates.test.ts.

// lintFlaggedWord is what the check-jingjing stub flags.
const lintFlaggedWord = "approach"

const lintFlaggedLine = "這個 " + lintFlaggedWord + " 很好用。\n"

// installContentLintStubs installs every content check as a stub that passes,
// except check-jingjing, which flags lintFlaggedWord like the real check does.
func installContentLintStubs(t *testing.T, scriptsDir string) {
	t.Helper()
	pass := "console.log('ok');\n"
	jingjing := `import fs from 'node:fs';
const file = process.argv[process.argv.length - 1];
if (fs.readFileSync(file, 'utf8').includes('` + lintFlaggedWord + `')) {
  console.error('L20: ` + lintFlaggedWord + `\n    │ 這個 ` + lintFlaggedWord + ` 很好用。');
  process.exit(1);
}
console.log('clean');
`
	for _, name := range contentLintScripts {
		body := pass
		if name == "check-jingjing.mjs" {
			body = jingjing
		}
		if err := os.WriteFile(filepath.Join(scriptsDir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

func finalResponse(body string) llm.FakeResponse {
	return llm.FakeResponse{Output: gpArticle(body), WriteFile: "final.mdx"}
}

// gpWriterWithRefine queues the draft, the review and the given refine outputs.
func gpWriterWithRefine(refines ...llm.FakeResponse) []llm.FakeResponse {
	return append([]llm.FakeResponse{
		{Output: gpArticle(gpDraftBody), WriteFile: "draft-v1.mdx"},
		{Output: "- nothing blocking\n", WriteFile: "review.md"},
	}, refines...)
}

func TestRun_GPContentLintFixedBeforeStamp(t *testing.T) {
	aligner := &scriptedAligner{modes: []string{"guide", "guide"}}
	s, fake, tmp := makeGPRunHarness(t, aligner, gpWriterWithRefine(
		finalResponse(gpDraftBody+lintFlaggedLine),
		finalResponse(gpDraftBody),
		translateResponse(),
	)...)
	_, _ = SetupWorkDir(s)

	if err := Run(context.Background(), s); err != nil {
		t.Fatalf("Run: %v", err)
	}
	// eval×2, write, review, refine, the content-check fix, translate.
	if got := len(fake.Called); got != 7 {
		t.Fatalf("writer calls = %d, want 7", got)
	}
	fix := writerPrompts(fake)[5]
	for _, want := range []string{"lint-draft.mdx", "Check report:", "L20: " + lintFlaggedWord} {
		if !strings.Contains(fix, want) {
			t.Fatalf("the content-check fix did not go through refine with %q:\n%s", want, fix)
		}
	}
	if strings.Contains(fix, "Flagged passages") {
		t.Fatal("the content-check fix used the source-distance rewrite prompt")
	}
	for _, p := range aligner.prompts {
		if strings.Contains(p, lintFlaggedWord) {
			t.Fatal("the aligner paired a body the content checks flagged")
		}
	}
	deployed := filepath.Join(s.Cfg.PostsDir, s.Filename)
	if strings.Contains(mustRead(t, deployed), lintFlaggedWord) {
		t.Fatal("the flagged line shipped")
	}
	if ok, errs := verifyStamp(t, tmp, deployed); !ok {
		t.Fatalf("deployed GP fails stamp verification: %v", errs)
	}
	if !strings.Contains(mustRead(t, filepath.Join(s.WorkDir, "content-lint", "report-1.txt")), lintFlaggedWord) {
		t.Error("the content-check report was not kept in the work dir")
	}
}

func TestRun_GPContentLintStillFailingStopsBeforePairing(t *testing.T) {
	aligner := &scriptedAligner{modes: []string{"guide", "guide"}}
	dirty := finalResponse(gpDraftBody + lintFlaggedLine)
	s, fake, _ := makeGPRunHarness(t, aligner, gpWriterWithRefine(dirty, dirty, dirty)...)
	_, _ = SetupWorkDir(s)
	before := counterNext(t, s)

	err := Run(context.Background(), s)
	assertStepCode(t, err, 14)
	if !strings.Contains(err.Error(), "content checks") {
		t.Fatalf("error = %v", err)
	}
	// eval×2, write, review, refine and MaxContentLintFixes fixes.
	if got, want := len(fake.Called), 5+MaxContentLintFixes; got != want {
		t.Fatalf("writer calls = %d, want %d", got, want)
	}
	if aligner.calls() != 0 {
		t.Fatalf("aligner calls = %d, want 0: a body that fails the content checks is not paired", aligner.calls())
	}
	if counterNext(t, s) != before || s.Filename != "" {
		t.Fatal("a GP that fails the content checks was deployed or allocated a ticket")
	}
}

func TestRun_GPContentLintAfterSourceDistanceRewrite(t *testing.T) {
	aligner := &scriptedAligner{modes: []string{"translate", "guide", "guide"}}
	s, fake, tmp := makeGPRunHarness(t, aligner, gpWriterWithRefine(
		finalResponse(gpDraftBody),
		finalResponse(gpRewrittenBody+lintFlaggedLine),
		finalResponse(gpRewrittenBody),
		translateResponse(),
	)...)
	_, _ = SetupWorkDir(s)

	if err := Run(context.Background(), s); err != nil {
		t.Fatalf("Run: %v", err)
	}
	prompts := writerPrompts(fake)
	if len(prompts) != 8 || !strings.Contains(prompts[5], "Flagged passages:") || !strings.Contains(prompts[6], "Check report:") {
		t.Fatalf("want refine, rewrite, then the content-check fix; got %d writer calls", len(prompts))
	}
	deployed := filepath.Join(s.Cfg.PostsDir, s.Filename)
	body := mustRead(t, deployed)
	if !strings.Contains(body, "沉默也要留紀錄") || strings.Contains(body, lintFlaggedWord) {
		t.Fatalf("the fixed rewrite did not ship:\n%s", body)
	}
	if stamp := readStamp(t, tmp, deployed); stamp == nil || stamp.Rewrites != 1 {
		t.Fatalf("stamp = %+v, want 1 source-distance rewrite (content-check fixes are not rewrites)", stamp)
	}
}

func TestRun_GPResumeRefusesABodyThatFailsTheContentChecks(t *testing.T) {
	aligner := &scriptedAligner{modes: []string{"guide", "guide"}}
	s, fake, _ := makeGPRunHarness(t, aligner)
	fake.Reset()
	s.FromStepInt = StepSourceDistance
	if err := os.WriteFile(filepath.Join(s.WorkDir, "final.mdx"), []byte(gpArticle(gpDraftBody+lintFlaggedLine)), 0o644); err != nil {
		t.Fatal(err)
	}

	err := Run(context.Background(), s)
	assertStepCode(t, err, 14)
	if !strings.Contains(err.Error(), "--from-step source-distance") {
		t.Fatalf("error = %v", err)
	}
	if len(fake.Called) != 0 || aligner.calls() != 0 {
		t.Fatalf("writer calls = %d, aligner calls = %d; resuming must neither refine nor pair", len(fake.Called), aligner.calls())
	}
}

// A check that cannot finish is neither a finding to fix nor a pass. Node exits
// 1 on an uncaught exception, the same code the checks use for findings, so a
// crash must not reach refine as a report.
func TestRun_GPContentCheckThatCannotRunStopsTheStep(t *testing.T) {
	for name, script := range map[string]string{
		"exits 2":           "process.exit(2);\n",
		"throws":            "throw new Error('glossary snapshot is corrupt');\n",
		"rejects a promise": "await Promise.reject(new Error('glossary snapshot is corrupt'));\n",
	} {
		t.Run(name, func(t *testing.T) {
			aligner := &scriptedAligner{modes: []string{"guide", "guide"}}
			s, fake, tmp := makeGPRunHarness(t, aligner, gpWriter()...)
			if err := os.WriteFile(filepath.Join(tmp, "scripts", "check-ai-tells.mjs"), []byte(script), 0o644); err != nil {
				t.Fatal(err)
			}
			_, _ = SetupWorkDir(s)

			err := Run(context.Background(), s)
			assertStepCode(t, err, 14)
			if !strings.Contains(err.Error(), "check-ai-tells.mjs could not run or crashed") {
				t.Fatalf("error = %v", err)
			}
			if len(fake.Called) != 5 || aligner.calls() != 0 {
				t.Fatalf("writer calls = %d, aligner calls = %d; a broken check is neither a finding to fix nor a pass", len(fake.Called), aligner.calls())
			}
		})
	}
}

// TestContentLintScriptsMatchPreCommitHook keeps contentLintScripts equal to
// the checks the pre-commit hook runs on staged zh-tw posts ("${ZH_FILES[@]}")
// plus its emoji check, which runs on every staged post, so the hook adding or
// dropping a zh-tw check, or the emoji check, fails here.
func TestContentLintScriptsMatchPreCommitHook(t *testing.T) {
	hook := mustRead(t, filepath.Join(realRepoRoot(t), "scripts", "hooks", "pre-commit"))
	zhChecks := regexp.MustCompile(`node "\$REPO_ROOT/scripts/([\w.-]+\.mjs)"[^\n]*"\$\{ZH_FILES\[@\]\}"`)
	var hookChecks []string
	for _, m := range zhChecks.FindAllStringSubmatch(hook, -1) {
		hookChecks = append(hookChecks, m[1])
	}
	if len(hookChecks) == 0 {
		t.Fatal("found no check the pre-commit hook runs on ZH_FILES; update this test with the hook")
	}
	const emojiCheck = "check-content-emoji.mjs"
	if strings.Contains(hook, `node "$REPO_ROOT/scripts/`+emojiCheck+`"`) {
		hookChecks = append(hookChecks, emojiCheck)
	}
	got, want := slices.Sorted(slices.Values(contentLintScripts)), slices.Sorted(slices.Values(hookChecks))
	if !slices.Equal(got, want) {
		t.Fatalf("contentLintScripts = %v, but the pre-commit hook runs %v (its zh-tw checks and the emoji check); keep them the same", got, want)
	}
}

// TestContentLintReportRunsTheRealChecks runs the repo's real content checks
// on a work-dir file: a clean GP body passes, and decorative English comes back
// as a report instead of an error.
func TestContentLintReportRunsTheRealChecks(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node unavailable")
	}
	root := realRepoRoot(t)
	s := NewState()
	s.Log = logx.New()
	s.Cfg = &config.Config{RepoRoot: root, ScriptsDir: filepath.Join(root, "scripts")}
	dir := t.TempDir()
	check := func(body string) string {
		t.Helper()
		file := filepath.Join(dir, "final.mdx")
		if err := os.WriteFile(file, []byte(gpArticle(body)), 0o644); err != nil {
			t.Fatal(err)
		}
		report, err := s.contentLintReport(context.Background(), file)
		if err != nil {
			t.Fatalf("contentLintReport: %v", err)
		}
		return report
	}
	// The synthetic author's name is not on the real allowlist, so this body
	// leaves it out.
	const clean = "這篇值得讀的是作者怎麼處理值班的沉默。\n\nMogu 覺得沒事也要寫一行。\n"
	if report := check(clean); report != "" {
		t.Fatalf("a clean GP body was flagged:\n%s", report)
	}
	if report := check(clean + lintFlaggedLine); !strings.Contains(report, "check-jingjing.mjs") || !strings.Contains(report, lintFlaggedWord) {
		t.Fatalf("decorative English did not come back as a report:\n%s", report)
	}
	if report := check(clean + "值班的沉默也值得記下 🚀\n"); !strings.Contains(report, "check-content-emoji.mjs") || !strings.Contains(report, "🚀") {
		t.Fatalf("an emoji did not come back as a report:\n%s", report)
	}
}
