package llm

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// writeAlignerAgent creates a throwaway repo root whose source-aligner.md
// frontmatter declares model.
func writeAlignerAgent(t *testing.T, model string) string {
	t.Helper()
	root := t.TempDir()
	dir := filepath.Join(root, ".claude", "agents")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	body := "---\nname: source-aligner\nmodel: " + model + "\ntools: []\n---\n\nbody\n"
	if err := os.WriteFile(filepath.Join(dir, "source-aligner.md"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	return root
}

// TestAlignerPinDiffersFromWriterPin reads both SSOTs — the aligner agent file
// and ClaudeOpusPinned, which TestClaudeWriterPinMatchesTribunalWriterFrontmatter
// locks to the writer agent — and compares them without context-variant
// suffixes (openspec source-distance-stamp).
func TestAlignerPinDiffersFromWriterPin(t *testing.T) {
	root := repoRootForRoutingTest(t)
	pin, err := AgentModelPin(root, AlignerAgentPath)
	if err != nil {
		t.Fatalf("read aligner pin: %v", err)
	}
	if BaseModelID(pin) == BaseModelID(ClaudeOpusPinned) {
		t.Fatalf("aligner pin %q equals the writer pin %q; the gate must not align with the writer's model", pin, ClaudeOpusPinned)
	}
	if got, err := AlignerPin(root); err != nil || got != pin {
		t.Fatalf("AlignerPin = (%q, %v), want (%q, nil)", got, err, pin)
	}
}

func TestAlignerPinRejectsTheWriterPin(t *testing.T) {
	for _, model := range []string{ClaudeOpusPinned, ClaudeOpusPinned + "[1m]"} {
		_, err := AlignerPin(writeAlignerAgent(t, model))
		if err == nil || !strings.Contains(err.Error(), "must differ from the writer pin") {
			t.Fatalf("AlignerPin(%q) error = %v, want the equal-pin refusal", model, err)
		}
	}
}

func TestAlignerPinFailsClosedWithoutAConcretePin(t *testing.T) {
	if _, err := AlignerPin(t.TempDir()); err == nil {
		t.Fatal("AlignerPin accepted a repo without .claude/agents/source-aligner.md")
	}
	for _, model := range []string{"sonnet", "", "gpt-5.5"} {
		if _, err := AlignerPin(writeAlignerAgent(t, model)); err == nil {
			t.Fatalf("AlignerPin accepted model %q", model)
		}
	}
}

func TestBaseModelIDDropsContextVariant(t *testing.T) {
	for in, want := range map[string]string{
		"claude-opus-5-5[1m]": "claude-opus-5-5",
		"claude-sonnet-5":     "claude-sonnet-5",
	} {
		if got := BaseModelID(in); got != want {
			t.Fatalf("BaseModelID(%q) = %q, want %q", in, got, want)
		}
	}
}

// TestAlignerProvidersAreContainedAndToolless covers both routes: a legacy
// caller builds the contained Claude call from the pin, and the VM profile
// resolves the same pin through the router. Neither gets any tool.
func TestAlignerProvidersAreContainedAndToolless(t *testing.T) {
	root := repoRootForRoutingTest(t)
	pin, err := AlignerPin(root)
	if err != nil {
		t.Fatal(err)
	}
	check := func(label string, providers []Provider) {
		t.Helper()
		if len(providers) != 1 {
			t.Fatalf("%s providers = %v, want one Claude provider", label, providers)
		}
		claude, ok := providers[0].(*ClaudeProvider)
		if !ok || claude.ModelFlag != pin || !claude.Contained || len(claude.Tools) != 0 || claude.Tools == nil {
			t.Fatalf("%s provider = %#v, want the contained, tool-less aligner pin %q", label, providers[0], pin)
		}
	}

	t.Setenv("TRIBUNAL_RUNTIME_PROFILE", "legacy")
	legacy, err := AlignerProviders(context.Background(), root)
	if err != nil {
		t.Fatalf("legacy AlignerProviders: %v", err)
	}
	check("legacy", legacy)

	installRuntimeFakes(t, true)
	vm, err := AlignerProviders(context.Background(), root)
	if err != nil {
		t.Fatalf("vm AlignerProviders: %v", err)
	}
	check("vm-codex", vm)
}
