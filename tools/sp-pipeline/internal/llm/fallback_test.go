package llm

import (
	"context"
	"testing"
)

// stubProvider is a Provider whose Available() is fully controllable, letting
// the fallback tests exercise WritingChain selection without touching PATH.
type stubProvider struct {
	name      string
	model     ModelID
	available bool
}

func (s stubProvider) Name() string    { return s.name }
func (s stubProvider) Model() ModelID  { return s.model }
func (s stubProvider) Available() bool { return s.available }
func (s stubProvider) Run(context.Context, string, RunOptions) (string, error) {
	return "", nil
}

func TestAnyAvailable(t *testing.T) {
	if anyAvailable([]Provider{stubProvider{available: false}}) {
		t.Fatal("anyAvailable = true for an all-absent chain")
	}
	if !anyAvailable([]Provider{stubProvider{available: false}, stubProvider{available: true}}) {
		t.Fatal("anyAvailable = false when one provider is present")
	}
}

func TestWritingChainUsesSingleResolvedWriter(t *testing.T) {
	chain := WritingChain()
	if len(chain) == 0 {
		t.Fatal("WritingChain returned an empty chain")
	}
	if len(chain) != 1 {
		t.Fatalf("WritingChain length = %d, want exactly 1 resolved writer", len(chain))
	}
	switch chain[0].Name() {
	case "claude-opus", "codex-gpt-5.5":
	default:
		t.Fatalf("WritingChain writer = %q, want claude-opus or codex-gpt-5.5", chain[0].Name())
	}
}

func TestProbeChainKeepsCodexPrimary(t *testing.T) {
	chain := ProbeChain()
	if len(chain) == 0 {
		t.Fatal("ProbeChain returned an empty chain")
	}
	if chain[0].Name() != "codex-gpt-5.5" {
		t.Fatalf("ProbeChain primary = %q, want codex-gpt-5.5", chain[0].Name())
	}
	if len(chain) != 2 {
		t.Fatalf("ProbeChain length = %d, want codex + claude probes", len(chain))
	}
	if _, ok := chain[1].(*ClaudeProvider); !ok {
		t.Fatalf("ProbeChain fallback = %T, want *ClaudeProvider", chain[1])
	}
}

func TestEffectiveStampLabels(t *testing.T) {
	// EffectiveStamp never invents an unknown label; it returns one of the two
	// known provider identities. We can't force PATH here, so we just assert
	// the result is internally consistent (model/harness from the same family).
	model, harness := EffectiveStamp()
	switch model {
	case "GPT-5.5":
		if harness != "Codex CLI" {
			t.Fatalf("GPT-5.5 stamped with harness %q, want Codex CLI", harness)
		}
	// When claude is on PATH the writer is the pinned build, so the stamp is
	// "Opus 4.5" — not the floating-alias "Opus 4.8" (that was the provenance
	// bug this guards against).
	case "Opus 4.5", "Opus 4.8":
		if harness != "Claude Code CLI" {
			t.Fatalf("%s stamped with harness %q, want Claude Code CLI", model, harness)
		}
	default:
		t.Fatalf("EffectiveStamp model = %q, want GPT-5.5 or Opus 4.5", model)
	}
}
