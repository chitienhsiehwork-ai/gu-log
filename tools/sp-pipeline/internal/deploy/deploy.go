// Package deploy is the Go implementation of sp-pipeline.sh Step 5 —
// validate-posts → build → git add → git commit → git push.
//
// The Phase 3 port stays byte-compatible with bash: it calls `node
// scripts/validate-posts.mjs`, `npm run build` (not pnpm — see plan),
// and `git commit -m "Add ${TICKET}: ${TITLE}"`.
package deploy

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/config"
	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/counter"
	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/frontmatter"
	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/logx"
	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/observability"
	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/runner"
)

// dateStampRe matches the YYYYMMDD filename date-stamp format used by both
// ralph.go's pending-filename builder and the final deploy filename.
var dateStampRe = regexp.MustCompile(`^\d{8}$`)

// validateFilenameSlots fails loud, before any counter bump / rename /
// commit / push, when the caller has not supplied everything needed to
// build a well-formed final filename. Without this, an operator invoking
// the standalone `deploy` subcommand without --date-stamp/--author-slug/
// --title-slug would silently produce a filename like "sp-252---.mdx"
// (see gu-log #546). Deliberately does NOT try to derive the missing
// slots by reverse-parsing ActiveFilename: the pending filename format
// (<prefix>-pending-YYYYMMDD-<author>-<title>.mdx) has no delimiter
// between the author and title slugs, so a guessed split could produce a
// well-formed but semantically wrong filename instead of failing loud.
func validateFilenameSlots(opts Options) error {
	var missing []string
	if opts.DateStamp == "" {
		missing = append(missing, "--date-stamp")
	} else if !dateStampRe.MatchString(opts.DateStamp) {
		return fmt.Errorf("deploy: --date-stamp must be YYYYMMDD, got %q", opts.DateStamp)
	}
	if opts.AuthorSlug == "" {
		missing = append(missing, "--author-slug")
	}
	if opts.TitleSlug == "" {
		missing = append(missing, "--title-slug")
	}
	if len(missing) > 0 {
		return fmt.Errorf("deploy: missing required flag(s) %s — refusing to build a filename with empty slots (see gu-log #546)", strings.Join(missing, ", "))
	}
	return nil
}

// Options controls a deploy invocation. Use Strict=false to skip the git
// push (used by --dry-run and by tests that own a fake git repo).
type Options struct {
	Cfg     *config.Config
	Log     *logx.Logger
	Counter *counter.Counter

	// Prefix is the ticket prefix (SP / CP / SD / Lv).
	Prefix string
	// ActiveFilename is the pre-rename posts/ file.
	ActiveFilename string
	// ActiveENFilename is the en- companion pre-rename.
	ActiveENFilename string
	// DateStamp / AuthorSlug / TitleSlug rebuild the final filename.
	DateStamp  string
	AuthorSlug string
	TitleSlug  string
	// Title is used in the commit message.
	Title string
	// TicketID identifies an already-allocated post on recovery deploys.
	// Fresh Run callers leave it empty because the counter allocates it.
	TicketID string

	// SkipBuild disables `npm run build` (test convenience).
	SkipBuild bool
	// SkipPush disables `git push` (test + --dry-run convenience).
	SkipPush bool
	// SkipValidate disables `node scripts/validate-posts.mjs` (tests only).
	SkipValidate bool
}

// Result captures the side effects of a deploy run so callers can populate
// the pipeline State with the final ticket ID + filenames.
type Result struct {
	SPNumber       int
	PromptTicketID string
	Filename       string
	ENFilename     string
}

// RunExisting publishes changes to an already-allocated post without bumping
// the counter or renaming files. Recovery via `run --from-step ... --file`
// still owns the full publish contract: validate, build, stage, commit, push.
func RunExisting(ctx context.Context, opts Options) (*Result, error) {
	if opts.Cfg == nil {
		return nil, fmt.Errorf("deploy existing: Cfg required")
	}
	if opts.Log == nil {
		return nil, fmt.Errorf("deploy existing: Log required")
	}
	if opts.ActiveFilename == "" {
		return nil, fmt.Errorf("deploy existing: ActiveFilename required")
	}
	if err := rejectPreExistingStagedChanges(ctx, opts.Cfg.RepoRoot); err != nil {
		return nil, err
	}

	postsDir := opts.Cfg.PostsDir
	activePath := filepath.Join(postsDir, opts.ActiveFilename)
	if info, err := os.Stat(activePath); err != nil {
		return nil, fmt.Errorf("deploy existing: stat %s: %w", activePath, err)
	} else if !info.Mode().IsRegular() {
		return nil, fmt.Errorf("deploy existing: %s is not a regular file", activePath)
	}

	enFilename := opts.ActiveENFilename
	if enFilename == "" {
		enFilename = "en-" + opts.ActiveFilename
	}
	if _, err := os.Stat(filepath.Join(postsDir, enFilename)); err != nil {
		if !os.IsNotExist(err) {
			return nil, fmt.Errorf("deploy existing: stat %s: %w", enFilename, err)
		}
		enFilename = ""
	}

	if err := checkPendingArtifacts(opts.Cfg.RepoRoot); err != nil {
		return nil, err
	}
	if !opts.SkipValidate {
		if err := runValidate(ctx, opts.Cfg.RepoRoot, opts.Cfg.ValidatePosts); err != nil {
			return nil, fmt.Errorf("deploy: validate-posts rejected existing file %s: %w", opts.ActiveFilename, err)
		}
	}
	if !opts.SkipBuild {
		if err := runNpmBuild(ctx, opts.Cfg.RepoRoot); err != nil {
			return nil, fmt.Errorf("deploy: npm run build failed: %w", err)
		}
	}

	addPaths := []string{"src/content/posts/" + opts.ActiveFilename}
	if enFilename != "" {
		addPaths = append(addPaths, "src/content/posts/"+enFilename)
	}
	if err := gitAdd(ctx, opts.Cfg.RepoRoot, addPaths...); err != nil {
		return nil, fmt.Errorf("deploy: git add existing files: %w", err)
	}
	hasChanges, err := gitHasStagedChanges(ctx, opts.Cfg.RepoRoot, addPaths...)
	if err != nil {
		return nil, fmt.Errorf("deploy: inspect staged existing files: %w", err)
	}
	if hasChanges {
		identity := opts.TicketID
		if identity == "" {
			identity = opts.ActiveFilename
		}
		title := opts.Title
		if title == "" {
			title = opts.ActiveFilename
		}
		if err := gitCommit(ctx, opts.Cfg.RepoRoot, fmt.Sprintf("Update %s: %s", identity, title)); err != nil {
			return nil, fmt.Errorf("deploy: git commit existing files: %w", err)
		}
	} else {
		opts.Log.Info("  Existing-file deploy has no content changes to commit")
	}

	if dirty, err := gitStatusForPaths(ctx, opts.Cfg.RepoRoot, addPaths...); err != nil {
		return nil, fmt.Errorf("deploy: verify existing files clean: %w", err)
	} else if dirty != "" {
		return nil, fmt.Errorf("deploy: existing-file publish left owned paths dirty: %s", dirty)
	}
	if !opts.SkipPush {
		if err := gitPush(ctx, opts.Cfg.RepoRoot); err != nil {
			return nil, fmt.Errorf("deploy: git push: %w", err)
		}
	}

	return &Result{
		PromptTicketID: opts.TicketID,
		Filename:       opts.ActiveFilename,
		ENFilename:     enFilename,
	}, nil
}

// Run executes the deploy flow. See package doc for step order.
func Run(ctx context.Context, opts Options) (*Result, error) {
	if opts.Cfg == nil {
		return nil, fmt.Errorf("deploy: Cfg required")
	}
	if opts.Log == nil {
		return nil, fmt.Errorf("deploy: Log required")
	}
	if opts.Counter == nil {
		return nil, fmt.Errorf("deploy: Counter required")
	}
	if opts.ActiveFilename == "" {
		return nil, fmt.Errorf("deploy: ActiveFilename required")
	}
	if err := validateFilenameSlots(opts); err != nil {
		return nil, err
	}
	if err := rejectPreExistingStagedChanges(ctx, opts.Cfg.RepoRoot); err != nil {
		return nil, err
	}

	postsDir := opts.Cfg.PostsDir

	// 1. Bump the counter → allocated integer + ticket id.
	allocated, err := opts.Counter.Bump(opts.Prefix)
	if err != nil {
		return nil, fmt.Errorf("deploy: counter bump: %w", err)
	}
	ticketID := fmt.Sprintf("%s-%d", opts.Prefix, allocated)
	opts.Log.Info("  Counter locked+bumped at commit time: %s (next will be %d)", ticketID, allocated+1)

	// 2. Build the final filenames and rename pending files.
	prefixLower := strings.ToLower(opts.Prefix)
	finalFilename := fmt.Sprintf("%s-%d-%s-%s-%s.mdx", prefixLower, allocated, opts.DateStamp, opts.AuthorSlug, opts.TitleSlug)
	finalEN := "en-" + finalFilename

	renameIfNeeded := func(active, final string) error {
		if active == "" || active == final {
			return nil
		}
		activePath := filepath.Join(postsDir, active)
		finalPath := filepath.Join(postsDir, final)
		if _, err := os.Stat(activePath); os.IsNotExist(err) {
			return nil
		}
		if _, err := os.Stat(finalPath); err == nil {
			return fmt.Errorf("deploy: final filename already exists: %s", finalPath)
		}
		return os.Rename(activePath, finalPath)
	}
	if err := renameIfNeeded(opts.ActiveFilename, finalFilename); err != nil {
		return nil, err
	}
	if err := renameIfNeeded(opts.ActiveENFilename, finalEN); err != nil {
		return nil, err
	}

	// 3. Replace any PENDING ticketId references in the final files.
	if err := replacePendingTicketID(filepath.Join(postsDir, finalFilename), ticketID); err != nil {
		return nil, err
	}
	if _, err := os.Stat(filepath.Join(postsDir, finalEN)); err == nil {
		if err := replacePendingTicketID(filepath.Join(postsDir, finalEN), ticketID); err != nil {
			return nil, err
		}
	}
	if err := observability.RenameTribunalProgressEntry(opts.Cfg.RepoRoot, opts.ActiveFilename, finalFilename); err != nil {
		return nil, fmt.Errorf("deploy: rename tribunal progress entry: %w", err)
	}
	if err := checkPendingArtifacts(opts.Cfg.RepoRoot); err != nil {
		return nil, err
	}

	// 4. Validate (unless skipped).
	if !opts.SkipValidate {
		if err := runValidate(ctx, opts.Cfg.RepoRoot, opts.Cfg.ValidatePosts); err != nil {
			// Validation is a publish gate, not a best-effort diagnostic. Keep
			// the allocated/renamed files in place for explicit recovery, but do
			// not build, stage, commit, or push after any non-zero validator exit.
			return nil, fmt.Errorf("deploy: validate-posts rejected fresh publish for %s: %w", finalFilename, err)
		}
	}

	// 5. Build (unless skipped).
	if !opts.SkipBuild {
		if err := runNpmBuild(ctx, opts.Cfg.RepoRoot); err != nil {
			return nil, fmt.Errorf("deploy: npm run build failed: %w", err)
		}
	}

	// 6. Git add / commit / push.
	addPaths := []string{
		"src/content/posts/" + finalFilename,
		"scripts/article-counter.json",
	}
	if _, err := os.Stat(filepath.Join(postsDir, finalEN)); err == nil {
		addPaths = append(addPaths, "src/content/posts/"+finalEN)
	}
	if err := gitAdd(ctx, opts.Cfg.RepoRoot, addPaths...); err != nil {
		return nil, fmt.Errorf("deploy: git add: %w", err)
	}
	commitMsg := fmt.Sprintf("Add %s: %s", ticketID, opts.Title)
	if err := gitCommit(ctx, opts.Cfg.RepoRoot, commitMsg); err != nil {
		return nil, fmt.Errorf("deploy: git commit: %w", err)
	}
	if !opts.SkipPush {
		if err := gitPush(ctx, opts.Cfg.RepoRoot); err != nil {
			return nil, fmt.Errorf("deploy: git push: %w", err)
		}
	}

	return &Result{
		SPNumber:       allocated,
		PromptTicketID: ticketID,
		Filename:       finalFilename,
		ENFilename:     finalEN,
	}, nil
}

// rejectPreExistingStagedChanges keeps deploy from swallowing operator-owned
// index state. Both fresh and recovery deploys eventually run an unrestricted
// `git commit` so hooks can add derived manifests; an already non-empty index
// must therefore fail before counter, file, build, or index mutation.
func rejectPreExistingStagedChanges(ctx context.Context, repoRoot string) error {
	paths, err := gitStagedPaths(ctx, repoRoot)
	if err != nil {
		return fmt.Errorf("deploy: inspect pre-existing staged changes: %w", err)
	}
	if len(paths) == 0 {
		return nil
	}
	return fmt.Errorf("deploy: pre-existing staged changes %q; refusing to commit pipeline output; operator staging preserved", paths)
}

func checkPendingArtifacts(repoRoot string) error {
	violations, err := observability.CheckPendingArtifacts(repoRoot, observability.GuardrailOptions{})
	if err != nil {
		return fmt.Errorf("deploy: pending artifact guardrail: %w", err)
	}
	if len(violations) == 0 {
		return nil
	}
	labels := make([]string, 0, len(violations))
	for _, violation := range violations {
		label := violation.Kind
		if violation.Detail != "" {
			label += " (" + violation.Detail + ")"
		} else {
			label += " (" + violation.Path + ")"
		}
		labels = append(labels, label)
	}
	return fmt.Errorf("deploy: pending artifact guardrail blocked handoff: %s", strings.Join(labels, ", "))
}

// replacePendingTicketID opens a file, replaces the ticketId value in its
// frontmatter with ticketID, and writes the result. This is the Go port
// of the three-sed-call replace_pending_ticket_id function in bash.
func replacePendingTicketID(path, ticketID string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("replace pending: read %s: %w", path, err)
	}
	f, err := frontmatter.Parse(data)
	if err != nil {
		return fmt.Errorf("replace pending: parse %s: %w", path, err)
	}
	f.SetScalar("ticketId", `"`+ticketID+`"`)
	return os.WriteFile(path, f.Bytes(), 0o644)
}

func runValidate(ctx context.Context, repoRoot, validatePostsJS string) error {
	res, err := runner.RunWithOptions(ctx, runner.Options{
		Name:    "node",
		Args:    []string{validatePostsJS},
		WorkDir: repoRoot,
	})
	if err == nil {
		return nil
	}
	// Include stdout in the error so the caller can check for specific
	// filenames in the validator output.
	return fmt.Errorf("%s\n%s", err, string(res.Stdout))
}

func runNpmBuild(ctx context.Context, repoRoot string) error {
	_, err := runner.RunWithOptions(ctx, runner.Options{
		Name:    "npm",
		Args:    []string{"run", "build"},
		WorkDir: repoRoot,
	})
	return err
}
