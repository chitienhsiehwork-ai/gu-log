package llm

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/logx"
)

func TestIsQuotaError(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"codex usage limit", errors.New("You've hit your usage limit. Try again later."), true},
		{"claude rate limit", errors.New("Error: 429 Too Many Requests: rate limit exceeded"), true},
		{"real error", errors.New("permission denied reading file"), false},
	}
	for _, tc := range cases {
		if got := IsQuotaError("codex-gpt-5.5", tc.err); got != tc.want {
			t.Fatalf("%s: IsQuotaError = %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestParseQuotaUsage(t *testing.T) {
	raw := `== Codex 0.139.0 (oauth) ==
Session: 70% left [========----]
Resets in 12m
Weekly: 64% left [=======-----]
Pace: On pace | Expected 36% used | Runs out in 4d 10h
Resets in 4d 11h
Credits: 0 left
Account: pnk7x9qwyw@privaterelay.appleid.com
Plan: Pro 5x

== Claude 2.1.177 (claude) ==
Session: 4% left [------------]
Resets in 2h 44m
Weekly: 90% left [==========--]
Pace: 6% in deficit | Expected 4% used | Runs out in 2d 8h
Resets in 6d 17h
`
	codex, err := ParseQuotaUsage("codex-gpt-5.5", raw)
	if err != nil {
		t.Fatal(err)
	}
	if codex.BlockingTier() != QuotaTierSession {
		t.Fatalf("codex blocking tier = %s", codex.BlockingTier())
	}
	if codex.SessionPercentLeft == nil || *codex.SessionPercentLeft != 70 {
		t.Fatalf("codex session percent = %v, want 70", codex.SessionPercentLeft)
	}
	if codex.WeeklyPercentLeft == nil || *codex.WeeklyPercentLeft != 64 {
		t.Fatalf("codex weekly percent = %v, want 64", codex.WeeklyPercentLeft)
	}
	if codex.SessionResetDuration != 12*time.Minute {
		t.Fatalf("codex session reset = %s", codex.SessionResetDuration)
	}
	if codex.WeeklyResetDuration != 107*time.Hour {
		t.Fatalf("codex weekly reset = %s", codex.WeeklyResetDuration)
	}

	claude, err := ParseQuotaUsage("claude-opus", raw)
	if err != nil {
		t.Fatal(err)
	}
	if claude.BlockingTier() != QuotaTierSession {
		t.Fatalf("claude blocking tier = %s", claude.BlockingTier())
	}
	if claude.SessionPercentLeft == nil || *claude.SessionPercentLeft != 4 {
		t.Fatalf("claude session percent = %v, want 4", claude.SessionPercentLeft)
	}
	if claude.WeeklyPercentLeft == nil || *claude.WeeklyPercentLeft != 90 {
		t.Fatalf("claude weekly percent = %v, want 90", claude.WeeklyPercentLeft)
	}
	if claude.SessionResetDuration != 2*time.Hour+44*time.Minute {
		t.Fatalf("claude session reset = %s", claude.SessionResetDuration)
	}
	if claude.WeeklyResetDuration != 161*time.Hour {
		t.Fatalf("claude weekly reset = %s", claude.WeeklyResetDuration)
	}
}

func TestParseResetDurationIgnoresPaceRunsOutLine(t *testing.T) {
	if got := parseResetDuration("Pace: On pace | Expected 36% used | Runs out in 4d 10h"); got != 0 {
		t.Fatalf("pace line reset duration = %s, want 0", got)
	}
	if got := parseResetDuration("Resets in 3d 4h"); got != 76*time.Hour {
		t.Fatalf("3d 4h reset duration = %s, want 76h", got)
	}
}

func TestJudgeQuotaCanFallBackToClaudeWhenExplicitlyEnabled(t *testing.T) {
	codex := NewFakeCodex().WithResponses(FakeResponse{Err: "429 Too Many Requests: usage limit"})
	claude := NewFakeClaude().WithResponses(FakeResponse{Output: "ok"})
	disp, err := NewDispatcher(logx.New(), codex, claude)
	if err != nil {
		t.Fatal(err)
	}
	policy := DefaultQuotaPolicy()
	policy.AllowClaudeJudgeFallback = true
	disp.ConfigureQuotaPolicy(policy)

	res, err := disp.Run(context.Background(), "judge", RunOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if res.ProviderName != claude.Name() {
		t.Fatalf("provider = %s, want %s", res.ProviderName, claude.Name())
	}
	if len(codex.Called) != 1 || len(claude.Called) != 1 {
		t.Fatalf("calls: codex=%d claude=%d", len(codex.Called), len(claude.Called))
	}
}
