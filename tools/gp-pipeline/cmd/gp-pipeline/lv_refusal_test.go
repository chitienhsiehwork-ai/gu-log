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

// What only Lv does: credits refuses it too, and its non-writing steps keep
// working. The refusals Lv shares with GP are in refusal_test.go.

func requireLvRefusal(t *testing.T, err error) {
	t.Helper()
	if err == nil || exitCodeFor(err) != 1 || !strings.Contains(err.Error(), "CONTRIBUTING.md") {
		t.Fatalf("error = %v (exit %d), want the exit-1 Lv refusal pointing to CONTRIBUTING.md", err, exitCodeFor(err))
	}
}

// TestCreditsRefusesLvPosts: an Lv post, by filename or by frontmatter
// ticketId, never gets the pipeline credit stamp. A GP keeps it
// (TestStandaloneCreditsKeepsGPBody).
func TestCreditsRefusesLvPosts(t *testing.T) {
	root := makeFakeRepo(t)
	t.Setenv("GU_LOG_DIR", root)
	trapLog := trapExternalPrograms(t)
	const lvPost = "---\ntitle: \"Lv\"\nticketId: \"Lv-PENDING\"\nlang: zh-tw\n---\nbody\n"
	const untaggedPost = "---\ntitle: \"Lv\"\nlang: zh-tw\n---\nbody\n"

	for filename, body := range map[string]string{
		"lv-40-20261012-example.mdx": untaggedPost,
		"final.mdx":                  lvPost,
	} {
		t.Run("credits "+filename, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), filename)
			mustWrite(t, path, body)
			err := executeCLI(t, "credits", "--file", path)
			requireLvRefusal(t, err)
			requireNoExternalCalls(t, trapLog)
			requireBytes(t, path, []byte(body))
		})
	}

	// A --file named final.mdx gets the stamp on the work dir's final.mdx, so
	// either one being Lv is refused.
	const gpPost = "---\ntitle: \"GP\"\nticketId: \"GP-PENDING\"\nlang: zh-tw\n---\nbody\n"
	for name, tc := range map[string]struct{ file, stamped string }{
		"credits GP final.mdx, Lv final.mdx in --work-dir": {file: gpPost, stamped: lvPost},
		"credits Lv final.mdx, GP final.mdx in --work-dir": {file: lvPost, stamped: gpPost},
	} {
		t.Run(name, func(t *testing.T) {
			file := filepath.Join(t.TempDir(), "final.mdx")
			mustWrite(t, file, tc.file)
			workDir := t.TempDir()
			stamped := filepath.Join(workDir, "final.mdx")
			mustWrite(t, stamped, tc.stamped)
			err := executeCLI(t, "credits", "--file", file, "--work-dir", workDir)
			requireLvRefusal(t, err)
			requireNoExternalCalls(t, trapLog)
			requireBytes(t, file, []byte(tc.file))
			requireBytes(t, stamped, []byte(tc.stamped))
		})
	}
}

// TestLvKeepsNonWritingSteps: a hand-written Lv still gets its number, its
// English version, and its deploy from the pipeline. run --from-step translate
// is covered by TestRunCommand_FromStepTranslateDryRunReportsSidecarAndSkipsGitMutations.
func TestLvKeepsNonWritingSteps(t *testing.T) {
	root := makeFakeRepo(t)
	postsDir := filepath.Join(root, "src", "content", "posts")
	if err := os.MkdirAll(postsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	const filename = "lv-18-20261011-example.mdx"
	const zhPost = "---\ntitle: \"Lv\"\nticketId: Lv-18\nlang: zh-tw\n---\n中文內容。\n"
	zhPath := filepath.Join(postsDir, filename)
	mustWrite(t, zhPath, zhPost)
	fakeSpec, err := json.Marshal(map[string]any{
		"model":     "claude-opus-5",
		"responses": []map[string]string{{"output": "---\ntitle: \"Lv\"\nticketId: Lv-18\nlang: \"en\"\n---\nEnglish body.\n"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	fakePath := filepath.Join(root, "fake-provider.json")
	mustWrite(t, fakePath, string(fakeSpec))
	t.Setenv("GU_LOG_DIR", root)

	t.Run("translate --file", func(t *testing.T) {
		if err := executeCLI(t, "--fake-provider", fakePath, "translate", "--file", filename, "--work-dir", t.TempDir()); err != nil {
			t.Fatalf("translate --file %s: %v", filename, err)
		}
		if _, err := os.Stat(filepath.Join(postsDir, "en-"+filename)); err != nil {
			t.Fatalf("English sidecar not written: %v", err)
		}
		requireBytes(t, zhPath, []byte(zhPost))
	})

	t.Run("counter bump", func(t *testing.T) {
		if err := executeCLI(t, "counter", "bump", "--prefix", "Lv"); err != nil {
			t.Fatalf("counter bump --prefix Lv: %v", err)
		}
		raw, err := os.ReadFile(filepath.Join(root, "scripts", "article-counter.json"))
		if err != nil {
			t.Fatal(err)
		}
		var counters map[string]struct {
			Next int `json:"next"`
		}
		if err := json.Unmarshal(raw, &counters); err != nil {
			t.Fatal(err)
		}
		if counters["Lv"].Next != 41 {
			t.Fatalf("Lv counter next = %d, want 41 after one bump", counters["Lv"].Next)
		}
	})

	t.Run("standalone deploy", func(t *testing.T) {
		if err := executeCLI(t, "deploy", "--active-file", "lv-pending-20261012-author-title.mdx",
			"--date-stamp", "20261012", "--author-slug", "author", "--title-slug", "title", "--dry-run"); err != nil {
			t.Fatalf("deploy dry-run of an Lv pending file: %v", err)
		}
	})

	t.Run("run --from-step deploy", func(t *testing.T) {
		emptyFake := filepath.Join(t.TempDir(), "fake.json")
		mustWrite(t, emptyFake, `{"responses":[]}`)
		// A translate start leaves the post in the work dir as final.mdx;
		// with --file, that is no reason to refuse.
		workDir := t.TempDir()
		mustWrite(t, filepath.Join(workDir, "final.mdx"), zhPost)
		if err := executeCLI(t, "--json", "--work-dir", workDir, "--fake-provider", emptyFake,
			"run", "--file", filename, "--from-step", "deploy", "--dry-run"); err != nil {
			t.Fatalf("run --from-step deploy for an Lv post: %v", err)
		}
	})
}

// TestSDRunPassesLvRefusal: SD keeps the writing pipeline. A run reaches its
// model route (the missing fake-provider spec) instead of the Lv refusal; the
// SD ralph cases live in TestStandaloneRalphInfersSeriesFromFilename.
func TestSDRunPassesLvRefusal(t *testing.T) {
	root := makeFakeRepo(t)
	t.Setenv("GU_LOG_DIR", root)
	err := executeCLI(t, "--work-dir", filepath.Join(t.TempDir(), "work"), "--fake-provider", filepath.Join(root, "missing.json"),
		"run", "https://x.com/author/status/1", "--prefix", "SD")
	if err == nil || !strings.Contains(err.Error(), "missing.json") || strings.Contains(err.Error(), "CONTRIBUTING.md") {
		t.Fatalf("error = %v, want SD to reach its model route", err)
	}
}

// TestLvRefusalNamesAnExistingSection keeps the refusal and the
// CONTRIBUTING.md heading it points at in step.
func TestLvRefusalNamesAnExistingSection(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "CONTRIBUTING.md"))
	if err != nil {
		t.Fatal(err)
	}
	heading := "### " + pipeline.LvWorkflowSection
	if !slices.Contains(strings.Split(string(raw), "\n"), heading) {
		t.Fatalf("CONTRIBUTING.md has no %q heading for the Lv refusal to point at", heading)
	}
}
