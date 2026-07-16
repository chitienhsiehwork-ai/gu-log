package main

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/observability"
)

func newStatusCmd(state *rootState) *cobra.Command {
	var staleAfter time.Duration
	cmd := &cobra.Command{
		Use:   "status [work_dir]",
		Short: "Summarize an active or recent pipeline run from its work dir + repo artifacts",
		Long: `status reads the per-run pipeline-status.json (when present), refreshes it
with live artifact + git + tribunal state, and prints one concise operator
card:

  - which step is/was active
  - which artifacts exist in the work dir
  - which tribunal stage is active
  - what the repo diff looks like
  - what the next expected action is
  - whether the run looks stale or suspicious

Pass the work dir as a positional argument, or reuse the root --work-dir flag.`,
		Args: cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			workDir := flagWorkDir
			if len(args) == 1 {
				workDir = args[0]
			}
			if workDir == "" {
				return fmt.Errorf("status: work dir required (pass status <dir> or root --work-dir)")
			}
			st, err := observability.Collect(state.cfg, workDir, observability.CollectOptions{StaleAfter: staleAfter})
			if err != nil {
				return err
			}
			emitStatus(state, st)
			if len(st.Suspicious) > 0 {
				return newExitError(1, fmt.Errorf("status: suspicious state: %s", strings.Join(st.Suspicious, "; ")))
			}
			return nil
		},
	}
	cmd.Flags().DurationVar(&staleAfter, "stale-after", observability.DefaultStaleAfter, "warn/fail if the run has been quiet longer than this")
	return cmd
}

func emitStatus(state *rootState, st *observability.RunStatus) {
	if state.json {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(st)
		return
	}

	fmt.Printf("Run state  : %s\n", fallback(st.RunState, "unknown"))
	fmt.Printf("Step       : %s\n", fallback(st.CurrentStep, fallback(st.LastCompletedStep, "unknown")))
	fmt.Printf("Work dir   : %s\n", st.WorkDir)
	if st.ActiveFilename != "" || st.Filename != "" {
		fmt.Printf("Article    : %s\n", fallback(st.Filename, st.ActiveFilename))
	}
	if existing := existingArtifacts(st.Artifacts); len(existing) > 0 {
		fmt.Printf("Artifacts  : %s\n", strings.Join(existing, ", "))
	}
	if st.Tribunal.Summary != "" {
		fmt.Printf("Tribunal   : %s\n", st.Tribunal.Summary)
	}
	if len(st.Git.ChangedFiles) > 0 {
		fmt.Printf("Git diff   : %d file(s) changed — %s\n", len(st.Git.ChangedFiles), strings.Join(limitStrings(st.Git.ChangedFiles, 4), ", "))
	}
	fmt.Printf("Next action: %s\n", st.NextAction)
	if st.StaleWarning != "" {
		fmt.Printf("Warning    : %s\n", st.StaleWarning)
	}
	if len(st.Guardrails.Violations) > 0 {
		fmt.Printf("Guardrail  : %s\n", strings.Join(renderViolations(st.Guardrails.Violations), "; "))
	}
}

func fallback(value, alt string) string {
	if value != "" {
		return value
	}
	return alt
}

func existingArtifacts(artifacts map[string]observability.Artifact) []string {
	var out []string
	for key, artifact := range artifacts {
		if artifact.Exists {
			out = append(out, key)
		}
	}
	sort.Strings(out)
	return out
}

func limitStrings(items []string, max int) []string {
	if len(items) <= max {
		return items
	}
	return append(append([]string{}, items[:max]...), fmt.Sprintf("+%d more", len(items)-max))
}

func renderViolations(violations []observability.GuardrailViolation) []string {
	out := make([]string, 0, len(violations))
	for _, violation := range violations {
		label := violation.Kind
		if violation.Detail != "" {
			label += " (" + violation.Detail + ")"
		} else {
			label += " (" + violation.Path + ")"
		}
		out = append(out, label)
	}
	return out
}
