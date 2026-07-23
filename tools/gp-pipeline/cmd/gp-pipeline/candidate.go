package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/spf13/cobra"

	candidatepkg "github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/candidate"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/source"
)

type candidateReport struct {
	OK           bool                   `json:"ok"`
	Step         string                 `json:"step"`
	WorkDir      string                 `json:"workDir,omitempty"`
	ManifestPath string                 `json:"manifestPath,omitempty"`
	ExitCode     int                    `json:"exitCode"`
	Manifest     *candidatepkg.Manifest `json:"manifest,omitempty"`
	Error        string                 `json:"error,omitempty"`
}

func newCandidateCmd(state *rootState) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "candidate <youtube-url>",
		Short: "Preflight one YouTube source for human review",
		Long: `candidate preflights exactly one allowlisted YouTube video.

It requires yt-dlp and writes only review evidence to a fresh private 0700
work directory outside the repository: candidate-manifest.json, raw VTT, a
timestamped transcript, and a source capture when the transcript is complete.
The manifest is the sole
machine-readable entrypoint and records nullable metadata, provenance, limits,
hashes, deterministic video-ID dedup, and writeEligible.

This command is review-only. It never calls an LLM and never runs Eval, Write,
Review, Refine, Credits, Ralph, Translate, Deploy, git, ticket allocation, or
article mutation. writeEligible is not approval. After human approval, start a
separate canonical run:

  gp-pipeline run <youtube-url> --prefix GP

Use --work-dir only with an existing writable parent outside this repo;
candidate always creates a new private leaf below it. Missing captions,
short/oversized transcripts, and live/upcoming videos still return a
reviewable manifest; inspect writeEligible and failure instead of treating
exit 0 as publication approval.`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return runCandidate(cmd.Context(), state, args[0])
		},
	}
	return cmd
}

func runCandidate(ctx context.Context, state *rootState, rawURL string) error {
	timeout := state.timeout
	if timeout <= 0 {
		timeout = 50 * time.Minute
	}
	candidateCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	outcome, err := candidatepkg.Run(candidateCtx, candidatepkg.Options{
		RepoRoot:    state.cfg.RepoRoot,
		WorkDir:     flagWorkDir,
		URL:         rawURL,
		DedupScript: filepath.Join(state.cfg.ScriptsDir, "dedup-gate.mjs"),
		Limits:      source.DefaultCandidateLimits(),
	})
	if err != nil {
		exitCode := 1
		report := candidateReport{
			OK:       false,
			Step:     "candidate",
			ExitCode: exitCode,
			Error:    err.Error(),
		}
		if outcome != nil {
			if outcome.ExitCode != 0 {
				exitCode = outcome.ExitCode
				report.ExitCode = exitCode
			}
			report.WorkDir = outcome.WorkDir
			report.ManifestPath = outcome.ManifestPath
			report.Manifest = outcome.Manifest
		}
		emitCandidateReport(state, report)
		return newExitError(exitCode, err)
	}

	report := candidateReport{
		OK:           outcome.ExitCode == 0,
		Step:         "candidate",
		WorkDir:      outcome.WorkDir,
		ManifestPath: outcome.ManifestPath,
		ExitCode:     outcome.ExitCode,
		Manifest:     outcome.Manifest,
	}
	if outcome.ExitCode != 0 && outcome.Manifest != nil && outcome.Manifest.Failure != nil {
		report.Error = outcome.Manifest.Failure.Code + ": " + outcome.Manifest.Failure.Message
	}
	emitCandidateReport(state, report)
	if outcome.ExitCode != 0 {
		message := fmt.Sprintf("candidate failed with exit code %d", outcome.ExitCode)
		if report.Error != "" {
			message += ": " + report.Error
		}
		return newExitError(outcome.ExitCode, fmt.Errorf("%s", message))
	}
	return nil
}

func emitCandidateReport(state *rootState, report candidateReport) {
	if state.json {
		encoder := json.NewEncoder(os.Stdout)
		encoder.SetIndent("", "  ")
		_ = encoder.Encode(report)
		return
	}
	if report.ManifestPath != "" {
		fmt.Printf("candidate manifest: %s\n", report.ManifestPath)
		fmt.Printf("candidate workdir:  %s\n", report.WorkDir)
	}
	if report.Manifest != nil {
		fmt.Printf("writeEligible:     %t (human approval still required)\n", report.Manifest.WriteEligible)
		fmt.Printf("dedup:             %s\n", report.Manifest.Dedup.Verdict)
		if report.Manifest.Failure != nil {
			fmt.Printf("source status:     %s — %s\n", report.Manifest.Failure.Code, report.Manifest.Failure.Message)
		}
	}
}
