package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"

	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/pipeline"
)

// newCreditsCmd is a hidden-friendly standalone entry point for the
// credits frontmatter patch. Exposed primarily for debugging —
// most callers use it through `sp-pipeline run`.
func newCreditsCmd(state *rootState) *cobra.Command {
	var (
		finalPath   string
		workDir     string
		writeModel  string
		reviewModel string
		refineModel string
	)
	cmd := &cobra.Command{
		Use:   "credits",
		Short: "Stamp pipeline credits into a final.mdx frontmatter (debugging)",
		Long: `credits is Step 4.6 of the pipeline. It rewrites translatedBy.model,
translatedBy.harness, translatedBy.pipeline (4-entry), and pipelineUrl
in the target file's frontmatter. Useful for debugging a single mdx
without running the full pipeline.`,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return runCredits(cmd.Context(), state, finalPath, workDir, writeModel, reviewModel, refineModel)
		},
	}
	cmd.Flags().StringVar(&finalPath, "file", "", "path to final.mdx (required)")
	cmd.Flags().StringVar(&workDir, "work-dir", "", "work directory (defaults to dirname of --file)")
	cmd.Flags().StringVar(&writeModel, "write-model", "Opus 4.6", "model stamped for the Written role")
	cmd.Flags().StringVar(&reviewModel, "review-model", "GPT-5.4", "model stamped for the Reviewed role")
	cmd.Flags().StringVar(&refineModel, "refine-model", "Opus 4.6", "model stamped for the Refined role")
	_ = cmd.MarkFlagRequired("file")
	return cmd
}

func runCredits(ctx context.Context, state *rootState, finalPath, workDir, writeModel, reviewModel, refineModel string) error {
	abs, err := filepath.Abs(finalPath)
	if err != nil {
		return err
	}
	if _, err := os.Stat(abs); err != nil {
		return fmt.Errorf("credits: file not found: %s", abs)
	}
	if workDir == "" {
		workDir = filepath.Dir(abs)
	}
	// The Credits method expects the file to be called "final.mdx" in
	// the work dir. If the caller pointed us at a differently named
	// file, copy it into a scratch work dir under that name.
	scratchWorkDir := workDir
	if filepath.Base(abs) != "final.mdx" {
		scratchWorkDir = filepath.Join(os.TempDir(), fmt.Sprintf("credits-scratch-%d", os.Getpid()))
		if err := os.MkdirAll(scratchWorkDir, 0o755); err != nil {
			return err
		}
		data, err := os.ReadFile(abs)
		if err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(scratchWorkDir, "final.mdx"), data, 0o644); err != nil {
			return err
		}
		defer os.RemoveAll(scratchWorkDir)
	}

	s := pipeline.NewState()
	s.Cfg = state.cfg
	s.Log = state.log
	s.WorkDir = scratchWorkDir
	s.WriteModel = writeModel
	s.ReviewModel = reviewModel
	s.RefineModel = refineModel

	if err := s.Credits(ctx); err != nil {
		return newExitError(1, err)
	}
	// Copy back if we used a scratch dir.
	if scratchWorkDir != workDir {
		data, err := os.ReadFile(filepath.Join(scratchWorkDir, "final.mdx"))
		if err != nil {
			return err
		}
		if err := os.WriteFile(abs, data, 0o644); err != nil {
			return err
		}
	}
	state.log.OK("credits: stamped %s", abs)
	return nil
}
