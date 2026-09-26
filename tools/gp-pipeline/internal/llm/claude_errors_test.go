package llm

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/logx"
)

type claudeCLIErrorSamples struct {
	Quota  []string `json:"quota"`
	Login  []string `json:"login"`
	Other  []string `json:"other"`
	Resets []struct {
		Message string `json:"message"`
		Now     string `json:"now"`
		Reset   string `json:"reset"`
	} `json:"resets"`
}

func loadClaudeCLIErrorSamples(t *testing.T) claudeCLIErrorSamples {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", "claude-cli-errors.json"))
	if err != nil {
		t.Fatal(err)
	}
	var samples claudeCLIErrorSamples
	if err := json.Unmarshal(data, &samples); err != nil {
		t.Fatal(err)
	}
	return samples
}

// TestClassifyClaudeFailureRealMessages classifies the messages the installed
// Claude CLI prints; the Tribunal shell classifier runs the same samples.
func TestClassifyClaudeFailureRealMessages(t *testing.T) {
	samples := loadClaudeCLIErrorSamples(t)
	for class, messages := range map[string][]string{
		ClaudeFailureQuota: samples.Quota,
		ClaudeFailureLogin: samples.Login,
		"":                 samples.Other,
	} {
		for _, message := range messages {
			if got := ClassifyClaudeFailure(message); got != class {
				t.Errorf("ClassifyClaudeFailure(%q) = %q, want %q", message, got, class)
			}
			if got := IsQuotaError("claude-opus", errors.New(message)); got != (class == ClaudeFailureQuota) {
				t.Errorf("IsQuotaError(claude, %q) = %v", message, got)
			}
		}
	}
}

func TestClaudeResetTimeRealMessages(t *testing.T) {
	for _, tc := range loadClaudeCLIErrorSamples(t).Resets {
		now, err := time.Parse(time.RFC3339, tc.Now)
		if err != nil {
			t.Fatal(err)
		}
		got, ok := ClaudeResetTime(tc.Message, now)
		if tc.Reset == "" {
			if ok {
				t.Errorf("ClaudeResetTime(%q) = %s, want no reset", tc.Message, got)
			}
			continue
		}
		want, err := time.Parse(time.RFC3339, tc.Reset)
		if err != nil {
			t.Fatal(err)
		}
		if !ok || !got.Equal(want) {
			t.Errorf("ClaudeResetTime(%q, now=%s) = (%s, %v), want %s", tc.Message, tc.Now, got, ok, want)
		}
	}
}

// TestClaudeQuotaActionUsesOnlyClaudeReset waits for the reset Claude
// reported, falls back to the conservative default without one, and never
// asks CodexBar, which only knows the Codex account.
func TestClaudeQuotaActionUsesOnlyClaudeReset(t *testing.T) {
	binDir := t.TempDir()
	marker := filepath.Join(t.TempDir(), "codexbar-called")
	writeExecutable(t, filepath.Join(binDir, "codexbar"), "#!/bin/sh\n: > \""+marker+"\"\nexit 1\n")
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	policy := QuotaPolicy{MaxWait: 6 * time.Hour, WaitBuffer: 2 * time.Minute, MaxWaits: 3}
	now := time.Date(2026, 9, 26, 12, 0, 0, 0, time.UTC)

	action := decideClaudeQuotaAction("claude-opus", errors.New("You've hit your session limit · resets 5pm (UTC)"), policy, 0, now)
	if !action.Wait || action.WaitDuration != 5*time.Hour+2*time.Minute || action.Tier != QuotaTierUnknown {
		t.Fatalf("reported reset action = %+v, want a wait until 17:00 UTC plus buffer", action)
	}
	action = decideClaudeQuotaAction("claude-opus", errors.New("You've hit your weekly limit · resets Sep 29, 5pm (UTC)"), policy, 0, now)
	if action.Wait || !action.ResetAt.Equal(time.Date(2026, 9, 29, 17, 0, 0, 0, time.UTC)) {
		t.Fatalf("far reset action = %+v, want a suspension that reports the Sep 29 reset", action)
	}
	t.Setenv("GP_CLAUDE_QUOTA_DEFAULT_WAIT", "45m")
	action = decideClaudeQuotaAction("claude-opus", errors.New("Your org is out of usage · contact your admin"), policy, 0, now)
	if !action.Wait || action.WaitDuration != 47*time.Minute {
		t.Fatalf("unknown reset action = %+v, want the conservative default plus buffer", action)
	}

	DecideQuotaAction("claude-opus", errors.New("You've hit your session limit · resets 5pm (UTC)"), policy, 0)
	if _, err := os.Stat(marker); !os.IsNotExist(err) {
		t.Fatal("a Claude quota decision ran codexbar")
	}
}

// TestDispatcherReportsMissingClaudeCLIAsActionable: the writing chain has no
// other provider, so a missing claude binary must say what to install.
func TestDispatcherReportsMissingClaudeCLIAsActionable(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	d, err := NewDispatcher(logx.New(), NewClaudeOpusWriter())
	if err != nil {
		t.Fatal(err)
	}
	_, err = d.Run(context.Background(), "write", RunOptions{})
	if err == nil || !strings.Contains(err.Error(), "claude CLI is not on PATH") || !strings.Contains(err.Error(), "claude auth login") {
		t.Fatalf("dispatcher error = %v, want an actionable missing-claude message", err)
	}
}

// TestDispatcherReportsClaudeLoginAsActionable keeps a login failure out of the
// quota path and tells the operator what to run.
func TestDispatcherReportsClaudeLoginAsActionable(t *testing.T) {
	claude := NewFakeClaude().WithResponses(FakeResponse{Err: "claude exited with code 1: Not logged in · Please run /login"})
	d, err := NewDispatcher(logx.New(), claude)
	if err != nil {
		t.Fatal(err)
	}
	_, err = d.Run(context.Background(), "write", RunOptions{})
	if err == nil || !strings.Contains(err.Error(), "claude auth login") {
		t.Fatalf("dispatcher error = %v, want the actionable Claude login message", err)
	}
	var suspend *QuotaSuspendError
	if errors.As(err, &suspend) {
		t.Fatalf("login failure was treated as a quota suspension: %v", err)
	}
}
