package llm

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/logx"
)

// Provider is the single surface we require of every LLM CLI wrapper.
type Provider interface {
	// Name is a short identifier used in logs ("claude-opus", "codex-gpt-5.4", …).
	Name() string
	// Model is the canonical ModelID, used to populate translatedBy.model.
	Model() ModelID
	// Available reports whether the underlying binary is on PATH. It is used
	// by the doctor subcommand and to skip dead links in a fallback chain
	// without a subprocess round-trip.
	Available() bool
	// Run sends prompt to the model and returns the stdout. ctx propagates
	// cancellation and timeout. opts carries invocation-specific knobs such
	// as the working directory — the bash pipeline's prompts assume they
	// run under a `cd $WORK_DIR && claude -p …` wrapper so that the LLM's
	// "write output to foo.json" instructions land in the right directory.
	Run(ctx context.Context, prompt string, opts RunOptions) (string, error)
}

// RunOptions configures a single provider invocation. The zero value is
// "inherit the parent process CWD, no extra env" and is what `doctor
// --probe-llm` and other throwaway callers use.
type RunOptions struct {
	// WorkDir is the child process working directory. When empty the
	// child inherits the parent's CWD.
	WorkDir string
}

// RunResult describes what came back from a Dispatcher.Run call.
type RunResult struct {
	// Output is the raw stdout from the successful provider.
	Output string
	// ProviderName is the provider that produced Output.
	ProviderName string
	// Model is the ModelID of the successful provider.
	Model ModelID
	// FellBackFrom is a list of provider names that failed before the
	// successful one ran (empty when the primary succeeded on the first try).
	FellBackFrom []string
}

// Dispatcher runs a prompt through an ordered list of providers, returning
// the output of the first one that succeeds. A provider is skipped with no
// warning when Available() is false (binary missing); it is tried and
// logged as a warning when Available() is true but Run() returns an error.
type Dispatcher struct {
	providers []Provider
	log       *logx.Logger
}

// NewDispatcher constructs a Dispatcher from an ordered slice of providers.
// The first provider in the slice is the primary; subsequent providers are
// fallbacks in order. At least one provider is required.
func NewDispatcher(log *logx.Logger, providers ...Provider) (*Dispatcher, error) {
	if len(providers) == 0 {
		return nil, errors.New("dispatcher: at least one provider is required")
	}
	return &Dispatcher{providers: providers, log: log}, nil
}

// Providers returns the ordered provider list (read-only snapshot).
func (d *Dispatcher) Providers() []Provider {
	out := make([]Provider, len(d.providers))
	copy(out, d.providers)
	return out
}

// Run executes prompt through the chain and returns the first success.
// If every provider fails, Run returns a multi-error containing each
// provider's reason. opts are forwarded to every provider attempt.
func (d *Dispatcher) Run(ctx context.Context, prompt string, opts RunOptions) (*RunResult, error) {
	var fellBack []string
	var errs []string

	for _, p := range d.providers {
		if !p.Available() {
			errs = append(errs, fmt.Sprintf("%s: binary not found on PATH", p.Name()))
			continue
		}
		d.log.Info("llm: trying %s (%s)", p.Name(), DisplayName(p.Model()))
		out, err := p.Run(ctx, prompt, opts)
		if err == nil {
			if len(fellBack) > 0 {
				d.log.Warn("llm: %s succeeded after %d provider(s) failed", p.Name(), len(fellBack))
			} else {
				d.log.OK("llm: %s succeeded", p.Name())
			}
			return &RunResult{
				Output:       out,
				ProviderName: p.Name(),
				Model:        p.Model(),
				FellBackFrom: fellBack,
			}, nil
		}
		d.log.Warn("llm: %s failed: %v", p.Name(), err)
		fellBack = append(fellBack, p.Name())
		errs = append(errs, fmt.Sprintf("%s: %v", p.Name(), err))
	}

	return nil, fmt.Errorf("all %d provider(s) failed:\n  - %s",
		len(d.providers), strings.Join(errs, "\n  - "))
}

// Probe runs a short canary prompt through each provider independently and
// reports which ones responded. Used by `sp-pipeline doctor --probe-llm`.
// A provider is "up" when Available() is true AND Run() returns without an
// error on the canary prompt.
func (d *Dispatcher) Probe(ctx context.Context) []ProbeResult {
	const canary = `Reply with exactly the single word "ok" and nothing else.`

	results := make([]ProbeResult, 0, len(d.providers))
	for _, p := range d.providers {
		r := ProbeResult{Provider: p.Name(), Model: p.Model()}
		if !p.Available() {
			r.Status = "missing"
			r.Detail = "binary not on PATH"
			results = append(results, r)
			continue
		}
		out, err := p.Run(ctx, canary, RunOptions{})
		if err != nil {
			r.Status = "error"
			r.Detail = err.Error()
		} else {
			r.Status = "ok"
			r.Detail = strings.TrimSpace(out)
			if len(r.Detail) > 80 {
				r.Detail = r.Detail[:80] + "..."
			}
		}
		results = append(results, r)
	}
	return results
}

// ProbeResult is one row in the --probe-llm report.
type ProbeResult struct {
	Provider string  `json:"provider"`
	Model    ModelID `json:"model"`
	Status   string  `json:"status"` // "ok" | "error" | "missing"
	Detail   string  `json:"detail"`
}
