package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"go.yaml.in/yaml/v3"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/llm"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/pipeline"
)

// TestStandaloneCreditsDefaultsToRuntimeStamp: without the model flags,
// credits stamps the runtime each role resolves to. Written and Refined credit
// the pinned Claude writer, never a hard-coded flag default that would pair
// another model with the Claude harness.
func TestStandaloneCreditsDefaultsToRuntimeStamp(t *testing.T) {
	root := makeFakeRepo(t)
	t.Setenv("GU_LOG_DIR", root)
	t.Setenv("GP_WRITER_PROVIDER", "")
	final := filepath.Join(t.TempDir(), "final.mdx")
	mustWrite(t, final, "---\ntitle: \"MP\"\nticketId: \"MP-PENDING\"\nlang: zh-tw\n"+
		"translatedBy:\n  model: \"stale\"\n  harness: \"stale\"\n---\nbody\n")

	if err := executeCLI(t, "credits", "--file", final); err != nil {
		t.Fatalf("credits: %v", err)
	}
	raw, err := os.ReadFile(final)
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.SplitN(string(raw), "---\n", 3)
	if len(parts) != 3 {
		t.Fatalf("no frontmatter in stamped file:\n%s", raw)
	}
	var fm struct {
		TranslatedBy struct {
			Model    string `yaml:"model"`
			Harness  string `yaml:"harness"`
			Pipeline []struct {
				Role    string `yaml:"role"`
				Model   string `yaml:"model"`
				Harness string `yaml:"harness"`
			} `yaml:"pipeline"`
		} `yaml:"translatedBy"`
	}
	if err := yaml.Unmarshal([]byte(parts[1]), &fm); err != nil {
		t.Fatalf("parse stamped frontmatter: %v\n%s", err, parts[1])
	}

	pin := llm.ModelID(llm.ClaudeOpusPinned)
	writer := [2]string{llm.DisplayName(pin), llm.HarnessName(pin)}
	judgeModel, judgeHarness := pipeline.NewState().JudgeStampLabels()
	want := map[string][2]string{
		"Written":  writer,
		"Reviewed": {judgeModel, judgeHarness},
		"Refined":  writer,
	}
	if got := [2]string{fm.TranslatedBy.Model, fm.TranslatedBy.Harness}; got != writer {
		t.Errorf("translatedBy model/harness = %v, want the Claude writer pin %v", got, writer)
	}
	seen := 0
	for _, entry := range fm.TranslatedBy.Pipeline {
		w, ok := want[entry.Role]
		if !ok {
			continue
		}
		seen++
		if got := [2]string{entry.Model, entry.Harness}; got != w {
			t.Errorf("%s = %v, want %v", entry.Role, got, w)
		}
	}
	if seen != len(want) {
		t.Fatalf("stamped pipeline has %d of the %d roles:\n%s", seen, len(want), parts[1])
	}
}
