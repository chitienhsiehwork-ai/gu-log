package candidate

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/source"
)

func TestPrepareWorkDirRejectsRepoAndSymlinkIntoRepo(t *testing.T) {
	repo := t.TempDir()
	if _, err := PrepareWorkDir(repo, repo); err == nil {
		t.Fatal("repo root must be rejected")
	}
	child := filepath.Join(repo, "candidate")
	if _, err := PrepareWorkDir(repo, child); err == nil {
		t.Fatal("repo child must be rejected")
	}

	linkRoot := t.TempDir()
	link := filepath.Join(linkRoot, "repo-link")
	if err := os.Symlink(repo, link); err != nil {
		t.Fatal(err)
	}
	if _, err := PrepareWorkDir(repo, filepath.Join(link, "candidate")); err == nil {
		t.Fatal("symlink resolving into repo must be rejected")
	}
	if _, err := os.Stat(filepath.Join(repo, ManifestFilename)); !os.IsNotExist(err) {
		t.Fatal("unsafe workdir must not receive a fallback manifest")
	}
}

func TestInvalidURLWritesNullableFailureManifestInSafeWorkDir(t *testing.T) {
	repo := t.TempDir()
	workDir := filepath.Join(t.TempDir(), "candidate")
	outcome, err := Run(context.Background(), Options{
		RepoRoot:    repo,
		WorkDir:     workDir,
		URL:         "https://youtube.com/playlist?list=PL123",
		DedupScript: filepath.Join(repo, "unused.mjs"),
		Limits:      source.DefaultCandidateLimits(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if outcome.ExitCode != 1 {
		t.Fatalf("exit = %d, want 1", outcome.ExitCode)
	}
	raw, err := os.ReadFile(outcome.ManifestPath)
	if err != nil {
		t.Fatal(err)
	}
	var manifest map[string]any
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatal(err)
	}
	if manifest["canonicalUrl"] != nil || manifest["videoId"] != nil {
		t.Fatalf("invalid URL identity fields must be null: %s", raw)
	}
	failure := manifest["failure"].(map[string]any)
	if failure["code"] != "invalid_url" {
		t.Fatalf("failure = %#v", failure)
	}
}

func TestRunProducesHashedReviewManifestAndOverwritesStaleEvidence(t *testing.T) {
	repo := t.TempDir()
	workDir := t.TempDir()
	binDir := installCandidateFixtures(t, workDir, "PASS\n", 0)
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	if err := os.WriteFile(
		filepath.Join(workDir, ManifestFilename),
		[]byte(`{"schemaVersion":1,"writeEligible":true,"rawInputUrl":"stale"}`),
		0o644,
	); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(workDir, "source-tweet.md"), []byte("stale"), 0o644); err != nil {
		t.Fatal(err)
	}

	outcome, err := Run(context.Background(), Options{
		RepoRoot:    repo,
		WorkDir:     workDir,
		URL:         "https://youtu.be/dQw4w9WgXcQ",
		DedupScript: filepath.Join(workDir, "dedup-gate.mjs"),
		Limits:      source.DefaultCandidateLimits(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if outcome.ExitCode != 0 || !outcome.Manifest.WriteEligible {
		t.Fatalf("outcome = %#v manifest=%#v", outcome, outcome.Manifest)
	}
	if outcome.Manifest.Approved || !outcome.Manifest.ApprovalRequired {
		t.Fatal("writeEligible must remain unapproved and require a human decision")
	}
	if outcome.Manifest.Caption == nil || outcome.Manifest.Caption.Kind != "manual" {
		t.Fatalf("caption = %#v", outcome.Manifest.Caption)
	}
	for name, artifact := range map[string]*Artifact{
		"source":     outcome.Manifest.Artifacts.Source,
		"rawVtt":     outcome.Manifest.Artifacts.RawVTT,
		"transcript": outcome.Manifest.Artifacts.Transcript,
	} {
		if artifact == nil {
			t.Fatalf("%s artifact missing", name)
		}
		if filepath.IsAbs(artifact.Path) {
			t.Fatalf("%s artifact path must be relative: %s", name, artifact.Path)
		}
		raw, err := os.ReadFile(filepath.Join(workDir, artifact.Path))
		if err != nil {
			t.Fatal(err)
		}
		sum := sha256.Sum256(raw)
		if got := hex.EncodeToString(sum[:]); got != artifact.SHA256 {
			t.Fatalf("%s hash = %s, want %s", name, artifact.SHA256, got)
		}
	}
	entries, err := filepath.Glob(filepath.Join(workDir, ".candidate-manifest-*.tmp"))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("atomic writer leaked temp files: %v", entries)
	}
	if outcome.Manifest.RawInputURL == "stale" {
		t.Fatal("stale manifest was silently reused")
	}
}

func TestRunExitSemantics(t *testing.T) {
	tests := []struct {
		name        string
		dedupOutput string
		dedupExit   int
		mutate      func(*source.CandidateLimits)
		wantExit    int
		wantFailure string
	}{
		{name: "dedup block", dedupOutput: "BLOCK: Duplicate of GP-1 (YouTube video ID match)\n", dedupExit: 1, wantExit: 13},
		{
			name:        "short reviewable source returns zero",
			dedupOutput: "PASS\n",
			mutate: func(limits *source.CandidateLimits) {
				limits.MinTranscriptWords = 1000
			},
			wantExit:    0,
			wantFailure: source.YouTubeFailureTranscriptShort,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			repo := t.TempDir()
			workDir := t.TempDir()
			binDir := installCandidateFixtures(t, workDir, test.dedupOutput, test.dedupExit)
			t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))
			limits := source.DefaultCandidateLimits()
			if test.mutate != nil {
				test.mutate(&limits)
			}
			outcome, err := Run(context.Background(), Options{
				RepoRoot:    repo,
				WorkDir:     workDir,
				URL:         "https://youtube.com/shorts/dQw4w9WgXcQ",
				DedupScript: filepath.Join(workDir, "dedup-gate.mjs"),
				Limits:      limits,
			})
			if err != nil {
				t.Fatal(err)
			}
			if outcome.ExitCode != test.wantExit {
				t.Fatalf("exit = %d, want %d", outcome.ExitCode, test.wantExit)
			}
			if test.wantFailure != "" &&
				(outcome.Manifest.Failure == nil || outcome.Manifest.Failure.Code != test.wantFailure) {
				t.Fatalf("failure = %#v, want %s", outcome.Manifest.Failure, test.wantFailure)
			}
			if test.wantExit != 0 && outcome.Manifest.WriteEligible {
				t.Fatal("blocked candidate must not remain write eligible")
			}
		})
	}
}

func TestRunTimeoutLeavesStableFailureManifest(t *testing.T) {
	repo := t.TempDir()
	workDir := t.TempDir()
	binDir := t.TempDir()
	writeExecutable(t, filepath.Join(binDir, "yt-dlp"), `#!/bin/sh
sleep 5
`)
	writeDedupScript(t, filepath.Join(workDir, "dedup-gate.mjs"), "PASS\n", 0)
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Millisecond)
	defer cancel()

	outcome, err := Run(ctx, Options{
		RepoRoot:    repo,
		WorkDir:     workDir,
		URL:         "https://youtube.com/watch?v=dQw4w9WgXcQ",
		DedupScript: filepath.Join(workDir, "dedup-gate.mjs"),
		Limits:      source.DefaultCandidateLimits(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if outcome.ExitCode != 124 {
		t.Fatalf("exit = %d, want 124", outcome.ExitCode)
	}
	if outcome.Manifest.Failure == nil || outcome.Manifest.Failure.Code != source.YouTubeFailureTimeout {
		t.Fatalf("failure = %#v", outcome.Manifest.Failure)
	}
	assertManifestValid(t, outcome.ManifestPath)
}

func TestRunCancellationLeavesInterruptedManifest(t *testing.T) {
	repo := t.TempDir()
	workDir := t.TempDir()
	binDir := t.TempDir()
	writeExecutable(t, filepath.Join(binDir, "yt-dlp"), `#!/bin/sh
sleep 5
`)
	writeDedupScript(t, filepath.Join(workDir, "dedup-gate.mjs"), "PASS\n", 0)
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	ctx, cancel := context.WithCancel(context.Background())
	timer := time.AfterFunc(25*time.Millisecond, cancel)
	defer timer.Stop()

	outcome, err := Run(ctx, Options{
		RepoRoot:    repo,
		WorkDir:     workDir,
		URL:         "https://youtube.com/watch?v=dQw4w9WgXcQ",
		DedupScript: filepath.Join(workDir, "dedup-gate.mjs"),
		Limits:      source.DefaultCandidateLimits(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if outcome.ExitCode != 10 {
		t.Fatalf("exit = %d, want 10", outcome.ExitCode)
	}
	if outcome.Manifest.Failure == nil ||
		outcome.Manifest.Failure.Code != source.YouTubeFailureInterrupted {
		t.Fatalf("failure = %#v", outcome.Manifest.Failure)
	}
	assertManifestValid(t, outcome.ManifestPath)
}

func TestRunMissingYTDLPReturnsTenAndLeavesManifest(t *testing.T) {
	nodePath, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node unavailable")
	}
	repo := t.TempDir()
	workDir := t.TempDir()
	binDir := t.TempDir()
	if err := os.Symlink(nodePath, filepath.Join(binDir, "node")); err != nil {
		t.Fatal(err)
	}
	writeDedupScript(t, filepath.Join(workDir, "dedup-gate.mjs"), "PASS\n", 0)
	t.Setenv("PATH", binDir)

	outcome, err := Run(context.Background(), Options{
		RepoRoot:    repo,
		WorkDir:     workDir,
		URL:         "https://youtube.com/watch?v=dQw4w9WgXcQ",
		DedupScript: filepath.Join(workDir, "dedup-gate.mjs"),
		Limits:      source.DefaultCandidateLimits(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if outcome.ExitCode != 10 {
		t.Fatalf("exit = %d, want 10", outcome.ExitCode)
	}
	if outcome.Manifest.Failure == nil ||
		outcome.Manifest.Failure.Code != source.YouTubeFailureDependencyMissing ||
		!outcome.Manifest.Failure.Retryable {
		t.Fatalf("failure = %#v", outcome.Manifest.Failure)
	}
	assertManifestValid(t, outcome.ManifestPath)
}

func TestCandidatePackageImportBoundary(t *testing.T) {
	denied := []string{
		"/internal/llm",
		"/internal/pipeline",
		"/internal/deploy",
		"/internal/counter",
		"/internal/ralph",
	}
	entries, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if strings.HasSuffix(entry, "_test.go") {
			continue
		}
		file, err := parser.ParseFile(token.NewFileSet(), entry, nil, parser.ImportsOnly)
		if err != nil {
			t.Fatal(err)
		}
		for _, imported := range file.Imports {
			path := strings.Trim(imported.Path.Value, `"`)
			for _, fragment := range denied {
				if strings.Contains(path, fragment) {
					t.Fatalf("%s imports forbidden agentic/mutation package %s", entry, path)
				}
			}
		}
	}
}

func TestCandidateDoesNotMutateCompleteRepoSnapshotOrCallTraps(t *testing.T) {
	gitPath, err := exec.LookPath("git")
	if err != nil {
		t.Fatal(err)
	}
	repo := t.TempDir()
	runGit(t, gitPath, repo, "init", "-q")
	runGit(t, gitPath, repo, "config", "user.name", "Candidate Test")
	runGit(t, gitPath, repo, "config", "user.email", "candidate@example.invalid")
	mustWrite(t, filepath.Join(repo, "CLAUDE.md"), "# sentinel\n", 0o644)
	mustWrite(t, filepath.Join(repo, "tracked.txt"), "tracked\n", 0o640)
	runGit(t, gitPath, repo, "add", "CLAUDE.md", "tracked.txt")
	runGit(t, gitPath, repo, "commit", "-qm", "fixture")
	mustWrite(t, filepath.Join(repo, "untracked.txt"), "untracked\n", 0o600)
	before := snapshotRepo(t, gitPath, repo)

	workDir := t.TempDir()
	binDir := installCandidateFixtures(t, workDir, "PASS\n", 0)
	trapLog := filepath.Join(workDir, "trap.log")
	for _, name := range []string{"git", "codex", "claude", "pnpm", "npm", "vercel"} {
		writeExecutable(t, filepath.Join(binDir, name), `#!/bin/sh
printf '%s\n' "$0 $*" >> "$CANDIDATE_TRAP_LOG"
exit 99
`)
	}
	t.Setenv("CANDIDATE_TRAP_LOG", trapLog)
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))

	outcome, err := Run(context.Background(), Options{
		RepoRoot:    repo,
		WorkDir:     workDir,
		URL:         "https://youtube.com/watch?v=dQw4w9WgXcQ",
		DedupScript: filepath.Join(workDir, "dedup-gate.mjs"),
		Limits:      source.DefaultCandidateLimits(),
	})
	if err != nil || outcome.ExitCode != 0 {
		t.Fatalf("candidate outcome=%#v err=%v", outcome, err)
	}
	after := snapshotRepo(t, gitPath, repo)
	if !reflect.DeepEqual(before, after) {
		t.Fatalf("repo snapshot changed\nbefore=%#v\nafter=%#v", before, after)
	}
	if raw, err := os.ReadFile(trapLog); err == nil {
		t.Fatalf("candidate invoked forbidden command:\n%s", raw)
	} else if !os.IsNotExist(err) {
		t.Fatal(err)
	}
}

type repoSnapshot struct {
	Head      string
	Refs      string
	IndexHash string
	Tracked   map[string]fileSnapshot
	Untracked map[string]fileSnapshot
}

type fileSnapshot struct {
	Hash string
	Mode fs.FileMode
}

func snapshotRepo(t *testing.T, gitPath, repo string) repoSnapshot {
	t.Helper()
	head := runGit(t, gitPath, repo, "rev-parse", "HEAD")
	refs := runGit(t, gitPath, repo, "show-ref")
	indexRaw, err := os.ReadFile(filepath.Join(repo, ".git", "index"))
	if err != nil {
		t.Fatal(err)
	}
	indexSum := sha256.Sum256(indexRaw)
	return repoSnapshot{
		Head:      head,
		Refs:      refs,
		IndexHash: hex.EncodeToString(indexSum[:]),
		Tracked:   snapshotPaths(t, repo, nulPaths(runGitBytes(t, gitPath, repo, "ls-files", "-z"))),
		Untracked: snapshotPaths(t, repo, nulPaths(runGitBytes(t, gitPath, repo, "ls-files", "--others", "--exclude-standard", "-z"))),
	}
}

func snapshotPaths(t *testing.T, repo string, paths []string) map[string]fileSnapshot {
	t.Helper()
	out := make(map[string]fileSnapshot, len(paths))
	sort.Strings(paths)
	for _, relative := range paths {
		path := filepath.Join(repo, relative)
		info, err := os.Lstat(path)
		if err != nil {
			t.Fatal(err)
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		sum := sha256.Sum256(raw)
		out[relative] = fileSnapshot{
			Hash: hex.EncodeToString(sum[:]),
			Mode: info.Mode(),
		}
	}
	return out
}

func nulPaths(raw []byte) []string {
	parts := bytes.Split(raw, []byte{0})
	var out []string
	for _, part := range parts {
		if len(part) > 0 {
			out = append(out, string(part))
		}
	}
	return out
}

func installCandidateFixtures(t *testing.T, workDir, dedupOutput string, dedupExit int) string {
	t.Helper()
	binDir := t.TempDir()
	metadataPath := filepath.Join(workDir, "metadata.json")
	vttPath := filepath.Join(workDir, "fixture.vtt")
	mustWrite(t, metadataPath, `{
  "title": "Candidate source",
  "channel": "Fixture channel",
  "upload_date": "20260722",
  "duration": 600,
  "subtitles": {"en": [{"ext": "vtt"}]},
  "automatic_captions": {"en": [{"ext": "vtt"}]}
}`, 0o644)
	mustWrite(t, vttPath, "WEBVTT\n\n00:00:00.000 --> 00:01:00.000\n"+strings.Repeat("word ", 240)+"\n", 0o644)
	writeExecutable(t, filepath.Join(binDir, "yt-dlp"), `#!/bin/sh
case " $* " in
  *" --no-playlist "*) ;;
  *) exit 91 ;;
esac
case " $* " in
  *" -J "*) cat "$CANDIDATE_METADATA"; exit 0 ;;
esac
cp "$CANDIDATE_VTT" "$CANDIDATE_VTT_OUTPUT"
`)
	t.Setenv("CANDIDATE_METADATA", metadataPath)
	t.Setenv("CANDIDATE_VTT", vttPath)
	t.Setenv("CANDIDATE_VTT_OUTPUT", filepath.Join(workDir, "youtube-caption-download.en.vtt"))
	writeDedupScript(t, filepath.Join(workDir, "dedup-gate.mjs"), dedupOutput, dedupExit)
	return binDir
}

func writeDedupScript(t *testing.T, path, output string, exit int) {
	t.Helper()
	script := `if (!process.argv.includes("--identity-only")) {
  process.stderr.write("missing identity-only boundary\n");
  process.exit(90);
}
process.stdout.write(` + "`" + strings.ReplaceAll(output, "`", "\\`") + "`" + `);
process.exit(` + string(rune('0'+exit)) + `);
`
	mustWrite(t, path, script, 0o644)
}

func writeExecutable(t *testing.T, path, body string) {
	t.Helper()
	mustWrite(t, path, body, 0o755)
}

func mustWrite(t *testing.T, path, body string, mode fs.FileMode) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), mode); err != nil {
		t.Fatal(err)
	}
}

func runGit(t *testing.T, gitPath, repo string, args ...string) string {
	t.Helper()
	return strings.TrimSpace(string(runGitBytes(t, gitPath, repo, args...)))
}

func runGitBytes(t *testing.T, gitPath, repo string, args ...string) []byte {
	t.Helper()
	cmd := exec.Command(gitPath, args...)
	cmd.Dir = repo
	output, err := cmd.Output()
	if err != nil {
		t.Fatalf("git %v: %v", args, err)
	}
	return output
}

func assertManifestValid(t *testing.T, path string) {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var manifest Manifest
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatalf("invalid manifest JSON: %v\n%s", err, raw)
	}
}
