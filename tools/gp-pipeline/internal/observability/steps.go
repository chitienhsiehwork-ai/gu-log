package observability

import "strings"

// Step ordering helpers for run-status snapshots. Step names follow
// stepsForState in internal/pipeline.

// resumeStepFor maps a snapshot step name to the --from-step value that
// re-runs it. Snapshot names follow stepsForState in internal/pipeline, which
// has steps `run --from-step` does not accept by name; an unknown step (for
// example provider-preflight) yields "" so the caller gives generic advice.
func resumeStepFor(step string) string {
	switch step {
	case "dedup-url":
		return "fetch" // gated between fetch and eval; only a fetch resume re-runs it
	case "credits":
		return "ralph" // runs whenever the resume point is ralph or earlier
	}
	if stepRank(step) < 0 {
		return ""
	}
	return step
}

func nextStepFor(step string) string {
	switch step {
	case "setup", "":
		return "fetch"
	case "fetch", "dedup-url":
		return "eval"
	case "eval":
		return "dedup"
	case "dedup":
		return "write"
	case "write":
		return "review"
	case "review":
		return "refine"
	case "refine", "credits":
		return "ralph"
	case "ralph":
		return "translate"
	case "translate":
		return "deploy"
	default:
		return ""
	}
}

func stepRank(step string) int {
	switch strings.ToLower(step) {
	case "setup":
		return 0
	case "fetch":
		return 1
	case "dedup-url":
		return 2
	case "eval":
		return 3
	case "dedup":
		return 4
	case "write":
		return 5
	case "review":
		return 6
	case "refine":
		return 7
	case "credits":
		return 8
	case "ralph":
		return 9
	case "translate":
		return 10
	case "deploy":
		return 11
	default:
		return -1
	}
}

func maxStep(a, b string) string {
	if stepRank(a) >= stepRank(b) {
		return a
	}
	return b
}
