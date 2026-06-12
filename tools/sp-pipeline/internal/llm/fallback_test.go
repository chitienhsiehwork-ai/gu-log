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

func TestWritingChainKeepsCodexPrimary(t *testing.T) {
	// WritingChain must always lead with the codex default so that the VPS/mac
	// dispatch order is unchanged; the only difference is an optional trailing
	// Claude fallback when codex is absent.
	chain := WritingChain()
	if len(chain) == 0 {
		t.Fatal("WritingChain returned an empty chain")
	}
	if chain[0].Name() != "codex-gpt-5.5" {
		t.Fatalf("WritingChain primary = %q, want codex-gpt-5.5", chain[0].Name())
	}
	// The chain is either codex-only (codex present) or codex+claude (codex
	// absent). It must never be claude-only or place claude before codex.
	switch len(chain) {
	case 1:
		// codex-only — fine.
	case 2:
		if _, ok := chain[1].(*ClaudeProvider); !ok {
			t.Fatalf("WritingChain fallback = %T, want *ClaudeProvider", chain[1])
		}
	default:
		t.Fatalf("WritingChain length = %d, want 1 or 2", len(chain))
	}
}

func TestProbeChainKeepsCodexPrimary(t *testing.T) {
	// ProbeChain mirrors WritingChain's invariant for the doctor --probe-llm
	// path: codex is always primary so VPS/mac probe output is unchanged; the
	// only difference is an optional trailing Claude probe when codex is absent
	// (the CCC sandbox case). It must never be claude-only or place claude
	// before codex.
	chain := ProbeChain()
	if len(chain) == 0 {
		t.Fatal("ProbeChain returned an empty chain")
	}
	if chain[0].Name() != "codex-gpt-5.5" {
		t.Fatalf("ProbeChain primary = %q, want codex-gpt-5.5", chain[0].Name())
	}
	switch len(chain) {
	case 1:
		// codex-only — fine.
	case 2:
		if _, ok := chain[1].(*ClaudeProvider); !ok {
			t.Fatalf("ProbeChain fallback = %T, want *ClaudeProvider", chain[1])
		}
	default:
		t.Fatalf("ProbeChain length = %d, want 1 or 2", len(chain))
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
	case "Opus 4.6":
		if harness != "Claude Code CLI" {
			t.Fatalf("Opus 4.6 stamped with harness %q, want Claude Code CLI", harness)
		}
	default:
		t.Fatalf("EffectiveStamp model = %q, want GPT-5.5 or Opus 4.6", model)
	}
}
