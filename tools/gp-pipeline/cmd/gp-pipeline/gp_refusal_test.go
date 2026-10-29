package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/pipeline"
)

// What only GP does: gp-pipeline never allocates a GP number (openspec
// gp-pipeline-publish-integrity), and a numbered GP keeps the non-writing
// steps. The refusals GP shares with Lv, and the helpers, are in
// refusal_test.go.

const gpPostBody = "---\ntitle: \"GP\"\nticketId: GP-10\nlang: zh-tw\n---\nbody\n"

func requireGPRefusal(t *testing.T, err error) {
	t.Helper()
	if err == nil || exitCodeFor(err) != 1 || !strings.Contains(err.Error(), "--prefix MP") ||
		!strings.Contains(err.Error(), pipeline.ReclassifyScript) {
		t.Fatalf("error = %v (exit %d), want the exit-1 GP refusal pointing to --prefix MP and %s",
			err, exitCodeFor(err), pipeline.ReclassifyScript)
	}
}

func requireGPAllocationRefusal(t *testing.T, err error) {
	t.Helper()
	if err == nil || exitCodeFor(err) != 1 || !strings.Contains(err.Error(), "does not allocate GP numbers") ||
		!strings.Contains(err.Error(), pipeline.ReclassifyScript) {
		t.Fatalf("error = %v (exit %d), want the exit-1 GP allocation refusal pointing to %s",
			err, exitCodeFor(err), pipeline.ReclassifyScript)
	}
}

// gpRepo is a fake repo holding one numbered GP post; it returns the repo
// root, the posts dir, and the counter file.
func gpRepo(t *testing.T, filename string) (root, postsDir, counterFile string) {
	t.Helper()
	root = makeFakeRepo(t)
	postsDir = filepath.Join(root, "src", "content", "posts")
	if err := os.MkdirAll(postsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	mustWrite(t, filepath.Join(postsDir, filename), gpPostBody)
	t.Setenv("GU_LOG_DIR", root)
	return root, postsDir, filepath.Join(root, "scripts", "article-counter.json")
}

// TestPipelineAllocatesNoGPNumber: counter bump and a standalone deploy of a
// GP pending file are refused before the counter or the file changes; dry-run
// changes nothing about that. counter next still reads the GP counter.
func TestPipelineAllocatesNoGPNumber(t *testing.T) {
	const pending = "gp-pending-20261012-author-title.mdx"
	_, postsDir, counterFile := gpRepo(t, pending)
	trapLog := trapExternalPrograms(t)
	counterBefore, err := os.ReadFile(counterFile)
	if err != nil {
		t.Fatal(err)
	}
	deploy := []string{"deploy", "--active-file", pending, "--date-stamp", "20261012", "--author-slug", "author", "--title-slug", "title"}
	for name, args := range map[string][]string{
		"counter bump":   {"counter", "bump", "--prefix", "GP"},
		"deploy":         deploy,
		"deploy dry-run": append(slices.Clone(deploy), "--dry-run"),
	} {
		t.Run(name, func(t *testing.T) {
			requireGPAllocationRefusal(t, executeCLI(t, args...))
			requireNoExternalCalls(t, trapLog)
			requireBytes(t, counterFile, counterBefore)
			requireBytes(t, filepath.Join(postsDir, pending), []byte(gpPostBody))
		})
	}
	t.Run("counter next", func(t *testing.T) {
		if err := executeCLI(t, "counter", "next", "--prefix", "GP"); err != nil {
			t.Fatalf("counter next --prefix GP: %v", err)
		}
		requireBytes(t, counterFile, counterBefore)
	})
}

// TestGPKeepsNonWritingSteps: a numbered GP still gets dedup, its English
// version (the MP flow, with no GP-only verbatim check), and its deploy from
// the pipeline. Its credits are covered by TestStandaloneCreditsKeepsGPBody,
// and run --from-step translate by
// TestRunCommand_FromStepTranslateDryRunReportsSidecarAndSkipsGitMutations.
func TestGPKeepsNonWritingSteps(t *testing.T) {
	const filename = "gp-10-20261012-author-title.mdx"
	root, postsDir, _ := gpRepo(t, filename)
	zhPath := filepath.Join(postsDir, filename)
	fakeSpec, err := json.Marshal(map[string]any{
		"model":     "claude-opus-5",
		"responses": []map[string]string{{"output": "---\ntitle: \"GP\"\nticketId: GP-10\nlang: \"en\"\n---\nEnglish body.\n"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	fakePath := filepath.Join(root, "fake-provider.json")
	mustWrite(t, fakePath, string(fakeSpec))

	t.Run("dedup", func(t *testing.T) {
		argsLog := filepath.Join(t.TempDir(), "dedup-args")
		mustWrite(t, filepath.Join(root, "scripts", "dedup-gate.mjs"),
			"import { writeFileSync } from 'node:fs';\n"+
				"writeFileSync("+jsonString(t, argsLog)+", process.argv.slice(2).join(' '));\n"+
				"console.log('PASS');\n")
		if err := executeCLI(t, "dedup", "--series", "GP", "--url", "https://example.org/source"); err != nil {
			t.Fatalf("dedup --series GP: %v", err)
		}
		raw, err := os.ReadFile(argsLog)
		if err != nil || !strings.Contains(string(raw), "--series GP") {
			t.Fatalf("dedup gate args = %q, %v; want --series GP", raw, err)
		}
	})

	t.Run("translate --file", func(t *testing.T) {
		if err := executeCLI(t, "--fake-provider", fakePath, "translate", "--file", filename, "--work-dir", t.TempDir()); err != nil {
			t.Fatalf("translate --file %s: %v", filename, err)
		}
		if _, err := os.Stat(filepath.Join(postsDir, "en-"+filename)); err != nil {
			t.Fatalf("English sidecar not written: %v", err)
		}
		requireBytes(t, zhPath, []byte(gpPostBody))
	})

	t.Run("run --from-step deploy", func(t *testing.T) {
		emptyFake := filepath.Join(t.TempDir(), "fake.json")
		mustWrite(t, emptyFake, `{"responses":[]}`)
		workDir := t.TempDir()
		mustWrite(t, filepath.Join(workDir, "final.mdx"), gpPostBody)
		if err := executeCLI(t, "--json", "--work-dir", workDir, "--fake-provider", emptyFake,
			"run", "--file", filename, "--from-step", "deploy", "--dry-run"); err != nil {
			t.Fatalf("run --from-step deploy for a GP post: %v", err)
		}
	})
}

func jsonString(t *testing.T, s string) string {
	t.Helper()
	raw, err := json.Marshal(s)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}
