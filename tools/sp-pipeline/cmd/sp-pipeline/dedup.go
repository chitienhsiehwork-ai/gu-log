package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/spf13/cobra"

	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/dedup"
)

// dedupReport is the JSON shape emitted by `sp-pipeline dedup --json`.
type dedupReport struct {
	OK        bool     `json:"ok"`
	Step      string   `json:"step"`
	Verdict   string   `json:"verdict"`
	URL       string   `json:"url,omitempty"`
	Title     string   `json:"title,omitempty"`
	Series    string   `json:"series,omitempty"`
	Matches   []string `json:"matches,omitempty"`
	ElapsedMs int64    `json:"elapsedMs"`
	ErrorCode int      `json:"errorCode,omitempty"`
	Error     string   `json:"error,omitempty"`
	Raw       string   `json:"raw,omitempty"` // only in --verbose mode
}

func newDedupCmd(state *rootState) *cobra.Command {
	var (
		url    string
		title  string
		series string
	)
	cmd := &cobra.Command{
		Use:   "dedup",
		Short: "Check the dedup gate against an existing URL / title",
		Long: `dedup wraps scripts/dedup-gate.mjs and returns a PASS / WARN / BLOCK
verdict plus the list of existing posts that match.

The underlying Node script is the source of truth for dedup logic — it
shares normalisation primitives with scripts/validate-posts.mjs (URL
canonicalisation, tweet ID extraction, fuzzy title similarity). This
subcommand only wraps it so agents get a typed exit code and JSON output.

Exit codes:
  0   PASS (no conflict)
  1   WARN or gate error (see stderr)
  13  BLOCK (duplicate confirmed)`,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return runDedup(cmd.Context(), state, url, title, series)
		},
	}
	cmd.Flags().StringVar(&url, "url", "", "source URL to check (X URL or article URL)")
	cmd.Flags().StringVar(&title, "title", "", "proposed title to check for similarity")
	cmd.Flags().StringVar(&series, "series", "SP", "ticket prefix (SP / CP / SD / Lv)")
	return cmd
}

func runDedup(ctx context.Context, state *rootState, url, title, series string) error {
	start := time.Now()

	// dedup-gate.mjs lives in scripts/ — resolve via config.
	scriptPath := filepath.Join(state.cfg.ScriptsDir, "dedup-gate.mjs")
	if _, err := os.Stat(scriptPath); err != nil {
		return fmt.Errorf("dedup: gate script missing at %s", scriptPath)
	}

	// Short per-step timeout; the gate is fast, anything >30s means it hung.
	stepCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	result, err := dedup.Check(stepCtx, dedup.Options{
		ScriptPath: scriptPath,
		URL:        url,
		Title:      title,
		Series:     series,
	})

	report := dedupReport{
		Step:   "dedup",
		URL:    url,
		Title:  title,
		Series: series,
	}
	if err != nil {
		report.OK = false
		report.Verdict = "ERROR"
		report.ErrorCode = 1
		report.Error = err.Error()
		report.ElapsedMs = time.Since(start).Milliseconds()
		emitDedupReport(state, report)
		return err
	}

	report.Verdict = string(result.Verdict)
	report.Matches = result.Matches
	report.ElapsedMs = time.Since(start).Milliseconds()
	if state.verbose {
		report.Raw = result.Raw
	}

	switch result.Verdict {
	case dedup.VerdictPass:
		report.OK = true
		emitDedupReport(state, report)
		state.log.OK("dedup: PASS — no conflicting posts")
		return nil
	case dedup.VerdictWarn:
		report.OK = true
		report.ErrorCode = 1
		emitDedupReport(state, report)
		state.log.Warn("dedup: WARN — %d potential match(es) (advisory only)", len(result.Matches))
		return nil
	case dedup.VerdictBlock:
		report.OK = false
		report.ErrorCode = 13
		report.Error = fmt.Sprintf("dedup gate blocked — %d match(es)", len(result.Matches))
		emitDedupReport(state, report)
		return newExitError(13, fmt.Errorf("dedup: BLOCK (%d match(es))", len(result.Matches)))
	default:
		report.OK = false
		report.ErrorCode = 1
		report.Error = "unknown verdict from gate"
		emitDedupReport(state, report)
		return fmt.Errorf("dedup: unknown verdict %q", result.Verdict)
	}
}

func emitDedupReport(state *rootState, r dedupReport) {
	if state.json {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(r)
		return
	}
	if r.OK && r.Verdict == "PASS" {
		fmt.Println("PASS")
		return
	}
	fmt.Println(r.Verdict)
	for _, m := range r.Matches {
		fmt.Printf("  %s\n", m)
	}
}
