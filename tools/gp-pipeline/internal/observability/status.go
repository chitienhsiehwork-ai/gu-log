package observability

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/config"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/runner"
)

const (
	StatusFileName    = "pipeline-status.json"
	DefaultStaleAfter = 15 * time.Minute
)

var pendingArticlePattern = regexp.MustCompile(`^(?:en-)?(?:gp|mp|sd|lv)-pending-.*\.mdx$`)

var tribunalStageOrder = []string{"factChecker", "librarian", "freshEyes", "vibe"}

var artifactFiles = map[string]string{
	"source":         "source-tweet.md",
	"evalPrimary":    "eval-codex-primary.json",
	"evalSecondary":  "eval-codex.json",
	"draft":          "draft-v1.mdx",
	"review":         "review.md",
	"final":          "final.mdx",
	"tribunalStdout": "tribunal-stdout.txt",
	"status":         StatusFileName,
}

type Artifact struct {
	Path       string `json:"path"`
	Exists     bool   `json:"exists"`
	SizeBytes  int64  `json:"sizeBytes,omitempty"`
	ModifiedAt string `json:"modifiedAt,omitempty"`
}

type Tribunal struct {
	Article    string `json:"article,omitempty"`
	Stage      string `json:"stage,omitempty"`
	Status     string `json:"status,omitempty"`
	Attempts   int    `json:"attempts,omitempty"`
	StartedAt  string `json:"startedAt,omitempty"`
	FinishedAt string `json:"finishedAt,omitempty"`
	Summary    string `json:"summary,omitempty"`
}

type Git struct {
	Dirty        bool     `json:"dirty"`
	ChangedFiles []string `json:"changedFiles,omitempty"`
}

type GuardrailViolation struct {
	Kind   string `json:"kind"`
	Path   string `json:"path"`
	Detail string `json:"detail,omitempty"`
}

type Guardrails struct {
	OK         bool                 `json:"ok"`
	Violations []GuardrailViolation `json:"violations,omitempty"`
}

type RunStatus struct {
	Version           int                 `json:"version"`
	RunState          string              `json:"runState,omitempty"`
	CurrentStep       string              `json:"currentStep,omitempty"`
	LastCompletedStep string              `json:"lastCompletedStep,omitempty"`
	WorkDir           string              `json:"workDir"`
	RepoRoot          string              `json:"repoRoot,omitempty"`
	Prefix            string              `json:"prefix,omitempty"`
	TweetURL          string              `json:"tweetUrl,omitempty"`
	TicketID          string              `json:"ticketId,omitempty"`
	ActiveFilename    string              `json:"activeFilename,omitempty"`
	ActiveENFilename  string              `json:"activeEnFilename,omitempty"`
	Filename          string              `json:"filename,omitempty"`
	ENFilename        string              `json:"enFilename,omitempty"`
	StartedAt         string              `json:"startedAt,omitempty"`
	UpdatedAt         string              `json:"updatedAt,omitempty"`
	Error             string              `json:"error,omitempty"`
	Artifacts         map[string]Artifact `json:"artifacts,omitempty"`
	Tribunal          Tribunal            `json:"tribunal,omitempty"`
	Git               Git                 `json:"git,omitempty"`
	Guardrails        Guardrails          `json:"guardrails"`
	NextAction        string              `json:"nextAction,omitempty"`
	StaleWarning      string              `json:"staleWarning,omitempty"`
	Suspicious        []string            `json:"suspicious,omitempty"`
}

type SnapshotInput struct {
	WorkDir           string
	RepoRoot          string
	Prefix            string
	TweetURL          string
	TicketID          string
	CurrentStep       string
	LastCompletedStep string
	RunState          string
	ActiveFilename    string
	ActiveENFilename  string
	Filename          string
	ENFilename        string
	Error             string
}

type CollectOptions struct {
	StaleAfter   time.Duration
	AllowPending []string
}

type GuardrailOptions struct {
	AllowPending []string
}

type tribunalProgressEntry struct {
	Article    string                           `json:"article"`
	Status     string                           `json:"status"`
	StartedAt  string                           `json:"startedAt"`
	FinishedAt string                           `json:"finishedAt"`
	Stages     map[string]tribunalProgressStage `json:"stages"`
}

type tribunalProgressStage struct {
	Status   string `json:"status"`
	Attempts int    `json:"attempts"`
}

func StatusFilePath(workDir string) string {
	return filepath.Join(workDir, StatusFileName)
}

func WriteSnapshot(cfg *config.Config, input SnapshotInput) error {
	if cfg == nil {
		return fmt.Errorf("observability: config is required")
	}
	if input.WorkDir == "" {
		return fmt.Errorf("observability: work dir is required")
	}
	absWorkDir, err := filepath.Abs(input.WorkDir)
	if err != nil {
		return fmt.Errorf("observability: abs work dir: %w", err)
	}
	if err := os.MkdirAll(absWorkDir, 0o755); err != nil {
		return fmt.Errorf("observability: mkdir work dir: %w", err)
	}

	status := &RunStatus{Version: 1, WorkDir: absWorkDir}
	if existing, err := readStatusFile(StatusFilePath(absWorkDir)); err == nil && existing != nil {
		status = existing
	}

	now := time.Now().Format(time.RFC3339)
	if status.StartedAt == "" {
		status.StartedAt = now
	}
	status.Version = 1
	status.WorkDir = absWorkDir
	status.RepoRoot = firstNonEmpty(input.RepoRoot, status.RepoRoot, cfg.RepoRoot)
	status.Prefix = firstNonEmpty(input.Prefix, status.Prefix)
	status.TweetURL = firstNonEmpty(input.TweetURL, status.TweetURL)
	status.TicketID = firstNonEmpty(input.TicketID, status.TicketID)
	status.CurrentStep = firstNonEmpty(input.CurrentStep, status.CurrentStep)
	status.LastCompletedStep = firstNonEmpty(input.LastCompletedStep, status.LastCompletedStep)
	status.RunState = firstNonEmpty(input.RunState, status.RunState)
	status.ActiveFilename = firstNonEmpty(input.ActiveFilename, status.ActiveFilename)
	status.ActiveENFilename = firstNonEmpty(input.ActiveENFilename, status.ActiveENFilename)
	status.Filename = firstNonEmpty(input.Filename, status.Filename)
	status.ENFilename = firstNonEmpty(input.ENFilename, status.ENFilename)
	status.Error = input.Error
	status.UpdatedAt = now

	allowPending := allowPendingForSnapshot(status)
	if err := enrichStatus(cfg, status, CollectOptions{StaleAfter: DefaultStaleAfter, AllowPending: allowPending}); err != nil {
		return err
	}

	body, err := json.MarshalIndent(status, "", "  ")
	if err != nil {
		return fmt.Errorf("observability: marshal status: %w", err)
	}
	body = append(body, '\n')
	if err := os.WriteFile(StatusFilePath(absWorkDir), body, 0o644); err != nil {
		return fmt.Errorf("observability: write status file: %w", err)
	}
	return nil
}

func Collect(cfg *config.Config, workDir string, opts CollectOptions) (*RunStatus, error) {
	if cfg == nil {
		return nil, fmt.Errorf("observability: config is required")
	}
	if workDir == "" {
		return nil, fmt.Errorf("observability: work dir is required")
	}
	absWorkDir, err := filepath.Abs(workDir)
	if err != nil {
		return nil, fmt.Errorf("observability: abs work dir: %w", err)
	}

	status := &RunStatus{Version: 1, WorkDir: absWorkDir, RepoRoot: cfg.RepoRoot}
	if existing, err := readStatusFile(StatusFilePath(absWorkDir)); err == nil && existing != nil {
		status = existing
	}
	status.Version = 1
	status.WorkDir = absWorkDir
	status.RepoRoot = firstNonEmpty(status.RepoRoot, cfg.RepoRoot)

	if opts.StaleAfter <= 0 {
		opts.StaleAfter = DefaultStaleAfter
	}
	if len(opts.AllowPending) == 0 {
		opts.AllowPending = allowPendingForSnapshot(status)
	}
	if err := enrichStatus(cfg, status, opts); err != nil {
		return nil, err
	}
	return status, nil
}

func CheckPendingArtifacts(repoRoot string, opts GuardrailOptions) ([]GuardrailViolation, error) {
	allow := make(map[string]bool)
	for _, item := range opts.AllowPending {
		for _, key := range []string{item, filepath.Base(item), filepath.ToSlash(item), "src/content/posts/" + filepath.Base(item)} {
			if key != "" {
				allow[key] = true
			}
		}
	}

	var violations []GuardrailViolation
	postsDir := filepath.Join(repoRoot, "src", "content", "posts")
	entries, err := os.ReadDir(postsDir)
	if err == nil {
		for _, entry := range entries {
			if entry.IsDir() {
				continue
			}
			name := entry.Name()
			if pendingArticlePattern.MatchString(name) && !allow[name] {
				violations = append(violations, GuardrailViolation{
					Kind:   "pending-post",
					Path:   filepath.ToSlash(filepath.Join("src", "content", "posts", name)),
					Detail: "leftover pending article file",
				})
			}
		}
	} else if !os.IsNotExist(err) {
		return nil, fmt.Errorf("observability: read posts dir: %w", err)
	}

	progressPath := filepath.Join(repoRoot, "scores", "tribunal-progress.json")
	progressData, err := os.ReadFile(progressPath)
	if err == nil {
		var progress map[string]json.RawMessage
		if unmarshalErr := json.Unmarshal(progressData, &progress); unmarshalErr != nil {
			return nil, fmt.Errorf("observability: parse tribunal-progress.json: %w", unmarshalErr)
		}
		keys := make([]string, 0, len(progress))
		for key := range progress {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			if pendingArticlePattern.MatchString(key) && !allow[key] {
				violations = append(violations, GuardrailViolation{
					Kind:   "pending-tribunal-progress",
					Path:   filepath.ToSlash(filepath.Join("scores", "tribunal-progress.json")),
					Detail: key,
				})
			}
		}
	} else if !os.IsNotExist(err) {
		return nil, fmt.Errorf("observability: read tribunal-progress.json: %w", err)
	}

	return violations, nil
}

func RenameTribunalProgressEntry(repoRoot, oldKey, newKey string) error {
	if repoRoot == "" || oldKey == "" || newKey == "" || oldKey == newKey {
		return nil
	}
	progressPath := filepath.Join(repoRoot, "scores", "tribunal-progress.json")
	data, err := os.ReadFile(progressPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("observability: read tribunal-progress.json: %w", err)
	}
	var progress map[string]json.RawMessage
	if err := json.Unmarshal(data, &progress); err != nil {
		return fmt.Errorf("observability: parse tribunal-progress.json: %w", err)
	}
	raw, ok := progress[oldKey]
	if !ok {
		return nil
	}
	var entry map[string]any
	if err := json.Unmarshal(raw, &entry); err == nil {
		entry["article"] = newKey
		if patched, patchErr := json.Marshal(entry); patchErr == nil {
			raw = patched
		}
	}
	delete(progress, oldKey)
	if _, exists := progress[newKey]; !exists {
		progress[newKey] = raw
	}
	body, err := json.MarshalIndent(progress, "", "  ")
	if err != nil {
		return fmt.Errorf("observability: marshal tribunal-progress.json: %w", err)
	}
	body = append(body, '\n')
	if err := os.WriteFile(progressPath, body, 0o644); err != nil {
		return fmt.Errorf("observability: write tribunal-progress.json: %w", err)
	}
	return nil
}

func readStatusFile(path string) (*RunStatus, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var status RunStatus
	if err := json.Unmarshal(data, &status); err != nil {
		return nil, err
	}
	return &status, nil
}

func enrichStatus(cfg *config.Config, status *RunStatus, opts CollectOptions) error {
	status.Artifacts = collectArtifacts(status.WorkDir)
	if status.LastCompletedStep == "" || status.CurrentStep == "" {
		inferStepsFromArtifacts(status)
	}
	inferRunState(status)

	gitStatus, err := collectGit(status.RepoRoot)
	if err == nil {
		status.Git = gitStatus
	} else {
		return err
	}

	article := articleCandidate(status)
	status.Tribunal = collectTribunal(status.RepoRoot, article)

	violations, err := CheckPendingArtifacts(status.RepoRoot, GuardrailOptions{AllowPending: opts.AllowPending})
	if err != nil {
		return err
	}
	status.Guardrails = Guardrails{OK: len(violations) == 0, Violations: violations}
	status.StaleWarning = buildStaleWarning(status, opts.StaleAfter)
	status.Suspicious = buildSuspicious(status)
	status.NextAction = deriveNextAction(status)
	return nil
}

func collectArtifacts(workDir string) map[string]Artifact {
	artifacts := make(map[string]Artifact, len(artifactFiles))
	for key, name := range artifactFiles {
		path := filepath.Join(workDir, name)
		artifact := Artifact{Path: path}
		if info, err := os.Stat(path); err == nil {
			artifact.Exists = true
			artifact.SizeBytes = info.Size()
			artifact.ModifiedAt = info.ModTime().Format(time.RFC3339)
		}
		artifacts[key] = artifact
	}
	return artifacts
}

func collectGit(repoRoot string) (Git, error) {
	if repoRoot == "" {
		return Git{}, nil
	}
	changed := make(map[string]struct{})
	for _, args := range [][]string{
		{"-C", repoRoot, "diff", "--name-only"},
		{"-C", repoRoot, "diff", "--cached", "--name-only"},
		{"-C", repoRoot, "ls-files", "--others", "--exclude-standard"},
	} {
		res, err := runner.Run(context.Background(), "git", args...)
		if err != nil {
			return Git{}, fmt.Errorf("observability: git %s: %w", strings.Join(args[2:], " "), err)
		}
		for _, line := range strings.Split(string(res.Stdout), "\n") {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			changed[line] = struct{}{}
		}
	}
	files := make([]string, 0, len(changed))
	for path := range changed {
		files = append(files, path)
	}
	sort.Strings(files)
	return Git{Dirty: len(files) > 0, ChangedFiles: files}, nil
}

func collectTribunal(repoRoot, article string) Tribunal {
	if repoRoot == "" || article == "" {
		return Tribunal{}
	}
	path := filepath.Join(repoRoot, "scores", "tribunal-progress.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return Tribunal{}
	}
	var progress map[string]tribunalProgressEntry
	if err := json.Unmarshal(data, &progress); err != nil {
		return Tribunal{}
	}
	entry, ok := progress[article]
	if !ok {
		return Tribunal{}
	}
	tribunal := Tribunal{
		Article:    article,
		Status:     entry.Status,
		StartedAt:  entry.StartedAt,
		FinishedAt: entry.FinishedAt,
	}
	for _, stageName := range tribunalStageOrder {
		stage := entry.Stages[stageName]
		if stage.Status == "in_progress" {
			tribunal.Stage = stageName
			tribunal.Status = stage.Status
			tribunal.Attempts = stage.Attempts
			tribunal.Summary = fmt.Sprintf("%s %s", stageName, stage.Status)
			return tribunal
		}
	}
	for _, want := range []string{"fail", "pass"} {
		for _, stageName := range tribunalStageOrder {
			stage := entry.Stages[stageName]
			if stage.Status == want {
				tribunal.Stage = stageName
				tribunal.Status = stage.Status
				tribunal.Attempts = stage.Attempts
			}
		}
		if tribunal.Stage != "" {
			break
		}
	}
	if tribunal.Summary == "" && tribunal.Stage != "" && tribunal.Status != "" {
		tribunal.Summary = fmt.Sprintf("%s %s", tribunal.Stage, tribunal.Status)
	}
	if tribunal.Summary == "" && tribunal.Status != "" {
		tribunal.Summary = tribunal.Status
	}
	return tribunal
}

func inferStepsFromArtifacts(status *RunStatus) {
	last := status.LastCompletedStep
	if status.Artifacts["source"].Exists {
		last = "fetch"
	}
	if status.Artifacts["evalPrimary"].Exists || status.Artifacts["evalSecondary"].Exists {
		last = "eval"
	}
	if status.Artifacts["draft"].Exists {
		last = "write"
	}
	if status.Artifacts["review"].Exists {
		last = "review"
	}
	if status.Artifacts["final"].Exists {
		last = "refine"
	}
	if status.Artifacts["tribunalStdout"].Exists || status.ActiveFilename != "" {
		last = "ralph"
	}
	if status.Filename != "" {
		last = "deploy"
	}
	if status.LastCompletedStep == "" {
		status.LastCompletedStep = last
	}
	if status.CurrentStep == "" {
		status.CurrentStep = last
	}
}

func inferRunState(status *RunStatus) {
	if status.RunState != "" {
		return
	}
	switch {
	case status.Error != "":
		status.RunState = "failed"
	case status.Filename != "" || status.ENFilename != "":
		status.RunState = "completed"
	case hasAnyArtifact(status.Artifacts) || status.CurrentStep != "":
		status.RunState = "running"
	default:
		status.RunState = "unknown"
	}
}

func hasAnyArtifact(artifacts map[string]Artifact) bool {
	for _, artifact := range artifacts {
		if artifact.Exists {
			return true
		}
	}
	return false
}

func buildStaleWarning(status *RunStatus, staleAfter time.Duration) string {
	if staleAfter <= 0 || status.RunState != "running" {
		return ""
	}
	last := latestActivityTime(status)
	if last.IsZero() {
		return ""
	}
	age := time.Since(last)
	if age <= staleAfter {
		return ""
	}
	return fmt.Sprintf("no status/artifact update for %s while %s is still running", humanDuration(age), nonEmpty(status.CurrentStep, "pipeline"))
}

func latestActivityTime(status *RunStatus) time.Time {
	var latest time.Time
	for _, value := range []string{status.UpdatedAt, status.Tribunal.FinishedAt, status.Tribunal.StartedAt} {
		if t := parseRFC3339(value); t.After(latest) {
			latest = t
		}
	}
	for _, artifact := range status.Artifacts {
		if t := parseRFC3339(artifact.ModifiedAt); t.After(latest) {
			latest = t
		}
	}
	return latest
}

func buildSuspicious(status *RunStatus) []string {
	var issues []string
	if status.StaleWarning != "" {
		issues = append(issues, status.StaleWarning)
	}
	for _, missing := range missingArtifacts(status) {
		issues = append(issues, missing)
	}
	for _, violation := range status.Guardrails.Violations {
		issue := violation.Kind
		if violation.Detail != "" {
			issue += ": " + violation.Detail
		} else {
			issue += ": " + violation.Path
		}
		issues = append(issues, issue)
	}
	return issues
}

func missingArtifacts(status *RunStatus) []string {
	var missing []string
	rank := stepRank(maxStep(status.CurrentStep, status.LastCompletedStep))
	if rank >= stepRank("write") && !status.Artifacts["source"].Exists {
		missing = append(missing, "source-tweet.md missing after write-stage progress")
	}
	if rank >= stepRank("review") && !status.Artifacts["draft"].Exists {
		missing = append(missing, "draft-v1.mdx missing after review-stage progress")
	}
	if rank >= stepRank("refine") && !status.Artifacts["review"].Exists {
		missing = append(missing, "review.md missing after refine-stage progress")
	}
	if rank >= stepRank("ralph") && !status.Artifacts["final"].Exists && status.ActiveFilename == "" {
		missing = append(missing, "final.mdx missing before tribunal/deploy")
	}
	if status.RunState == "completed" && status.Filename == "" {
		missing = append(missing, "completed run is missing final filename metadata")
	}
	return missing
}

func deriveNextAction(status *RunStatus) string {
	if len(status.Guardrails.Violations) > 0 {
		return "clean leftover pending draft / tribunal progress artifacts before deploy or PR handoff"
	}
	if status.RunState == "running" {
		return fmt.Sprintf("wait for %s to finish", nonEmpty(status.CurrentStep, "pipeline"))
	}
	if status.RunState == "failed" {
		if status.CurrentStep != "" {
			return fmt.Sprintf("inspect the %s failure, then resume with --from-step %s", status.CurrentStep, status.CurrentStep)
		}
		return "inspect the failure and resume from the last good step"
	}
	if status.RunState == "completed" {
		return "open PR / wait for CI handoff"
	}
	next := nextStepFor(nonEmpty(status.LastCompletedStep, status.CurrentStep))
	if next == "" {
		return "run fetch"
	}
	return fmt.Sprintf("run %s", next)
}

func nextStepFor(step string) string {
	switch step {
	case "setup", "":
		return "fetch"
	case "fetch":
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
		return "deploy"
	default:
		return ""
	}
}

func allowPendingForSnapshot(status *RunStatus) []string {
	if status.RunState != "running" {
		return nil
	}
	if status.CurrentStep != "ralph" && status.CurrentStep != "deploy" {
		return nil
	}
	var allow []string
	for _, name := range []string{status.ActiveFilename, status.ActiveENFilename} {
		if pendingArticlePattern.MatchString(name) {
			allow = append(allow, name)
		}
	}
	return allow
}

func articleCandidate(status *RunStatus) string {
	for _, candidate := range []string{status.ActiveFilename, status.Filename} {
		if candidate != "" {
			return candidate
		}
	}
	return ""
}

func stepRank(step string) int {
	switch strings.ToLower(step) {
	case "setup":
		return 0
	case "fetch":
		return 1
	case "eval":
		return 2
	case "dedup":
		return 3
	case "write":
		return 4
	case "review":
		return 5
	case "refine":
		return 6
	case "credits":
		return 7
	case "ralph":
		return 8
	case "deploy":
		return 9
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

func humanDuration(d time.Duration) string {
	if d < time.Minute {
		return fmt.Sprintf("%ds", int(d.Seconds()))
	}
	if d < time.Hour {
		return fmt.Sprintf("%dm", int(d.Minutes()))
	}
	if d < 24*time.Hour {
		return fmt.Sprintf("%dh", int(d.Hours()))
	}
	return fmt.Sprintf("%dd", int(d.Hours()/24))
}

func parseRFC3339(value string) time.Time {
	if value == "" {
		return time.Time{}
	}
	t, _ := time.Parse(time.RFC3339, value)
	return t
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func nonEmpty(value, fallback string) string {
	if value != "" {
		return value
	}
	return fallback
}
