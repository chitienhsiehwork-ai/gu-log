package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/spf13/cobra"

	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/source"
)

// fetchReport is the JSON shape emitted by `sp-pipeline fetch --json`.
type fetchReport struct {
	OK        bool              `json:"ok"`
	Step      string            `json:"step"`
	URL       string            `json:"url"`
	Output    fetchOutputReport `json:"output"`
	ElapsedMs int64             `json:"elapsedMs"`
	ErrorCode int               `json:"errorCode,omitempty"`
	Error     string            `json:"error,omitempty"`
}

type fetchOutputReport struct {
	SourceFile string `json:"sourceFile"`
	Handle     string `json:"handle,omitempty"`
	Date       string `json:"date,omitempty"`
	FetchedVia string `json:"fetchedVia,omitempty"`
	Bytes      int    `json:"bytes"`
}

func newFetchCmd(state *rootState) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "fetch <tweet_url>",
		Short: "Capture a tweet into a work directory",
		Long: `fetch downloads a tweet or X Article into the pipeline work directory.

For an X URL it shells out to scripts/fetch-x-article.sh (fxtwitter with
vxtwitter fallback), then runs the native Go validator over the result.
On validation failure it exits with code 11 so callers can distinguish
"fetch returned but the content looks contaminated" from "fetch itself
crashed" (exit code 10).

The resulting capture is written to <work-dir>/source-tweet.md and the
path is printed on stdout.`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return runFetch(cmd.Context(), state, args[0])
		},
	}
	return cmd
}

func runFetch(ctx context.Context, state *rootState, url string) error {
	start := time.Now()

	workDir, err := resolveWorkDir(state)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		return fmt.Errorf("fetch: mkdir %s: %w", workDir, err)
	}

	// Apply the pipeline-wide timeout (already on ctx from main) plus a
	// tighter per-step deadline so one stuck provider can't eat the whole
	// budget.
	stepCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()

	res, err := source.FetchX(stepCtx, url, source.FetchOptions{
		WorkDir:             workDir,
		FetchXArticleScript: state.cfg.FetchXArticle,
	})

	report := fetchReport{
		Step: "fetch",
		URL:  url,
	}
	if err != nil {
		report.OK = false
		report.Error = err.Error()
		code := 10
		if source.IsValidationError(err) {
			code = 11
		}
		report.ErrorCode = code
		report.ElapsedMs = time.Since(start).Milliseconds()
		emitFetchReport(state, report)
		return newExitError(code, fmt.Errorf("fetch failed: %w", err))
	}

	report.OK = true
	report.Output = fetchOutputReport{
		SourceFile: res.Path,
		Handle:     res.Handle,
		Date:       res.Date,
		FetchedVia: res.FetchedVia,
		Bytes:      res.Bytes,
	}
	report.ElapsedMs = time.Since(start).Milliseconds()
	emitFetchReport(state, report)
	state.log.OK("fetch: captured %d bytes from %s via %s", res.Bytes, res.Handle, res.FetchedVia)
	return nil
}

func resolveWorkDir(state *rootState) (string, error) {
	if flagWorkDir != "" {
		abs, err := filepath.Abs(flagWorkDir)
		if err != nil {
			return "", fmt.Errorf("fetch: work-dir %s: %w", flagWorkDir, err)
		}
		return abs, nil
	}
	// Default: $REPO/tmp/sp-pending-<unix>-pipeline, matching sp-pipeline.sh.
	stamp := time.Now().Unix()
	return filepath.Join(state.cfg.RepoRoot, "tmp", fmt.Sprintf("sp-pending-%d-pipeline", stamp)), nil
}

func emitFetchReport(state *rootState, report fetchReport) {
	if !state.json {
		if report.OK {
			fmt.Println(report.Output.SourceFile)
		}
		return
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	_ = enc.Encode(report)
}
