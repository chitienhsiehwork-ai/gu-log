package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"time"

	"github.com/spf13/cobra"

	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/llm"
	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/runner"
)

// doctorReport is the full JSON shape emitted with --json.
type doctorReport struct {
	GoVersion  string            `json:"goVersion"`
	GoOS       string            `json:"goOS"`
	GoArch     string            `json:"goArch"`
	RepoRoot   string            `json:"repoRoot"`
	Binaries   []binaryCheck     `json:"binaries"`
	Files      []fileCheck       `json:"files"`
	LLMProbes  []llm.ProbeResult `json:"llmProbes,omitempty"`
	OK         bool              `json:"ok"`
	FailReason string            `json:"failReason,omitempty"`
}

type binaryCheck struct {
	Name     string `json:"name"`
	Found    bool   `json:"found"`
	Path     string `json:"path,omitempty"`
	Required bool   `json:"required"`
}

type fileCheck struct {
	Name     string `json:"name"`
	Path     string `json:"path"`
	Found    bool   `json:"found"`
	Required bool   `json:"required"`
}

// requiredBinaries and optionalBinaries mirror sp-pipeline.sh's
// check_required_tools list, split by whether a missing entry is fatal.
var (
	requiredBinaries = []string{"git", "bash", "node", "python3", "curl"}
	optionalBinaries = []string{"claude", "codex", "gemini", "jq", "make", "pnpm"}
)

func newDoctorCmd(state *rootState) *cobra.Command {
	var probeLLM bool

	cmd := &cobra.Command{
		Use:   "doctor",
		Short: "Verify every external dependency is reachable",
		Long: `doctor reports on the health of the sp-pipeline execution environment.

It checks:

  - The Go version (must be >= 1.24 for this binary to build and run).
  - Every external binary the pipeline shells out to (claude, codex,
    gemini, node, python3, git, bash, curl, jq, make, pnpm).
  - Every repo-relative file the pipeline depends on (fetch-x-article.sh,
    validate-posts.mjs, article-counter.json, WRITING_GUIDELINES.md).
  - Optionally (--probe-llm), sends a 1-token canary prompt through each
    LLM provider to confirm they respond non-interactively. This is the
    intended early-warning for the "claude -p expects a TTY" failure mode.

Exit code 0 when everything required is present. Exit code 1 when any
required dependency is missing. Optional binaries and LLM probe failures
are reported but do not affect the exit code.`,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return runDoctor(cmd.Context(), state, probeLLM)
		},
	}

	cmd.Flags().BoolVar(&probeLLM, "probe-llm", false,
		"send a canary prompt through each LLM provider to confirm non-interactive behaviour")

	return cmd
}

func runDoctor(ctx context.Context, state *rootState, probeLLM bool) error {
	report := doctorReport{
		GoVersion: runtime.Version(),
		GoOS:      runtime.GOOS,
		GoArch:    runtime.GOARCH,
		RepoRoot:  state.cfg.RepoRoot,
		OK:        true,
	}

	for _, name := range requiredBinaries {
		path, err := runner.LookPath(name)
		report.Binaries = append(report.Binaries, binaryCheck{
			Name:     name,
			Found:    err == nil,
			Path:     path,
			Required: true,
		})
		if err != nil {
			report.OK = false
			if report.FailReason == "" {
				report.FailReason = "missing required binary: " + name
			}
		}
	}
	for _, name := range optionalBinaries {
		path, err := runner.LookPath(name)
		report.Binaries = append(report.Binaries, binaryCheck{
			Name:     name,
			Found:    err == nil,
			Path:     path,
			Required: false,
		})
	}

	fileChecks := []fileCheck{
		{Name: "fetch-x-article.sh", Path: state.cfg.FetchXArticle, Required: true},
		{Name: "validate-posts.mjs", Path: state.cfg.ValidatePosts, Required: true},
		{Name: "article-counter.json", Path: state.cfg.CounterFile, Required: true},
		{Name: "WRITING_GUIDELINES.md", Path: state.cfg.WritingGuide, Required: true},
	}
	for i := range fileChecks {
		fi, err := os.Stat(fileChecks[i].Path)
		fileChecks[i].Found = err == nil && !fi.IsDir()
		if !fileChecks[i].Found && fileChecks[i].Required {
			report.OK = false
			if report.FailReason == "" {
				report.FailReason = "missing required file: " + fileChecks[i].Name
			}
		}
	}
	report.Files = fileChecks

	if probeLLM {
		// Use a short per-provider timeout so doctor does not hang waiting
		// for a broken provider. 30s is generous — a 1-token canary
		// should complete in a few seconds.
		probeCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
		disp, err := llm.NewDispatcher(state.log, llm.DefaultProbeChain()...)
		if err == nil {
			report.LLMProbes = disp.Probe(probeCtx)
		} else {
			state.log.Warn("doctor: dispatcher init failed: %v", err)
		}
	}

	if state.json {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(report)
	}
	printDoctorHuman(state, report)
	if !report.OK {
		return fmt.Errorf("doctor: %s", report.FailReason)
	}
	return nil
}

func printDoctorHuman(state *rootState, r doctorReport) {
	fmt.Printf("sp-pipeline doctor\n")
	fmt.Printf("  go:       %s (%s/%s)\n", r.GoVersion, r.GoOS, r.GoArch)
	fmt.Printf("  repo:     %s\n", r.RepoRoot)
	fmt.Printf("\n")

	fmt.Printf("binaries:\n")
	for _, b := range r.Binaries {
		mark := markFor(b.Found, b.Required)
		path := b.Path
		if path == "" {
			path = "(not found)"
		}
		tag := "  optional"
		if b.Required {
			tag = "  REQUIRED"
		}
		fmt.Printf("  %s %-10s %s  %s\n", mark, b.Name, tag, path)
	}
	fmt.Printf("\n")

	fmt.Printf("files:\n")
	for _, f := range r.Files {
		mark := markFor(f.Found, f.Required)
		fmt.Printf("  %s %-24s %s\n", mark, f.Name, f.Path)
	}

	if len(r.LLMProbes) > 0 {
		fmt.Printf("\nllm probes:\n")
		for _, p := range r.LLMProbes {
			mark := "x"
			if p.Status == "ok" {
				mark = "+"
			}
			fmt.Printf("  %s %-18s %-22s %s\n", mark, p.Provider, llm.DisplayName(p.Model), p.Detail)
		}
	}

	fmt.Printf("\n")
	if r.OK {
		state.log.OK("doctor: environment looks healthy")
	} else {
		state.log.Error("doctor: %s", r.FailReason)
	}
}

func markFor(found, required bool) string {
	switch {
	case found:
		return "+"
	case !required:
		return "-"
	default:
		return "x"
	}
}
