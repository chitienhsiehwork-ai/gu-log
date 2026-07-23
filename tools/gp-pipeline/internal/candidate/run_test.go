package candidate

import (
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
	if _, err := PrepareWorkDir(repo, link); err == nil {
		t.Fatal("symlink resolving into repo must be rejected")
	}
	if _, err := os.Stat(filepath.Join(repo, ManifestFilename)); !os.IsNotExist(err) {
		t.Fatal("unsafe workdir must not receive a fallback manifest")
	}
}

func TestInvalidURLWritesNullableFailureManifestInSafeWorkDir(t *testing.T) {
	repo := t.TempDir()
	workDir := t.TempDir()
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
	if _, exists := manifest["approved"]; exists {
		t.Fatalf("manifest must not persist a half-implemented approved field: %s", raw)
	}
	failure := manifest["failure"].(map[string]any)
	if failure["code"] != "invalid_url" {
		t.Fatalf("failure = %#v", failure)
	}
}

func TestPrepareWorkDirAlwaysCreatesFreshPrivateLeaf(t *testing.T) {
	repo := t.TempDir()
	parent := t.TempDir()
	first, err := PrepareWorkDir(repo, parent)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	second, err := PrepareWorkDir(repo, parent)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	if first.Path == parent || second.Path == parent || first.Path == second.Path {
		t.Fatalf("expected distinct private leaves below parent: %q %q", first.Path, second.Path)
	}
	for _, work := range []*WorkDir{first, second} {
		info, err := os.Stat(work.Path)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0o700 {
			t.Fatalf("%s mode = %o, want 0700", work.Path, info.Mode().Perm())
		}
	}
}

func TestArtifactForRejectsSymlinkEscape(t *testing.T) {
	repo := t.TempDir()
	work, err := PrepareWorkDir(repo, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer work.Close()
	external := filepath.Join(t.TempDir(), "external.txt")
	mustWrite(t, external, "secret", 0o600)
	artifactPath := filepath.Join(work.Path, "source-tweet.md")
	if err := os.Symlink(external, artifactPath); err != nil {
		t.Fatal(err)
	}
	if _, err := artifactFor(work, artifactPath); err == nil ||
		!strings.Contains(err.Error(), "not a regular file") {
		t.Fatalf("artifactFor symlink error = %v", err)
	}
}

func TestRunDetectsDirectorySwapDuringYTDLP(t *testing.T) {
	repo := t.TempDir()
	parent := t.TempDir()
	fixtures := t.TempDir()
	metadataPath := filepath.Join(fixtures, "metadata.json")
	mustWrite(t, metadataPath, `{
  "id": "dQw4w9WgXcQ",
  "subtitles": {"en": [{"ext": "vtt"}]}
}`, 0o644)
	vttPath := filepath.Join(fixtures, "fixture.vtt")
	mustWrite(t, vttPath, "WEBVTT\n\n00:00:00.000 --> 00:01:00.000\n"+strings.Repeat("word ", 240), 0o644)
	binDir := t.TempDir()
	writeExecutable(t, filepath.Join(binDir, "yt-dlp"), `#!/bin/sh
case " $* " in
  *" -J "*) cat "$SWAP_METADATA"; exit 0 ;;
esac
output=""
previous=""
for argument in "$@"; do
  if [ "$previous" = "-o" ]; then output="$argument"; break; fi
  previous="$argument"
done
leaf="$(dirname "$output")"
mv "$leaf" "$leaf.moved"
mkdir -m 700 "$leaf"
cp "$SWAP_VTT" "$leaf/youtube-caption-download.en.vtt"
`)
	t.Setenv("SWAP_METADATA", metadataPath)
	t.Setenv("SWAP_VTT", vttPath)
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))

	outcome, err := Run(context.Background(), Options{
		RepoRoot: repo,
		WorkDir:  parent,
		URL:      "https://youtube.com/watch?v=dQw4w9WgXcQ",
		Limits:   source.DefaultCandidateLimits(),
	})
	if err == nil || !strings.Contains(err.Error(), "workdir path changed identity") {
		t.Fatalf("outcome=%#v error=%v", outcome, err)
	}
	if outcome == nil || outcome.Manifest == nil || outcome.Manifest.Failure == nil ||
		outcome.Manifest.Failure.Code != source.YouTubeFailureWorkDirChanged {
		t.Fatalf("workdir swap failure was not preserved: %#v", outcome)
	}
	if _, statErr := os.Stat(filepath.Join(outcome.WorkDir, ManifestFilename)); !os.IsNotExist(statErr) {
		t.Fatal("replacement directory received a candidate manifest")
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
	if !outcome.Manifest.ApprovalRequired {
		t.Fatal("writeEligible must still require a human decision")
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
		raw, err := os.ReadFile(filepath.Join(outcome.WorkDir, artifact.Path))
		if err != nil {
			t.Fatal(err)
		}
		sum := sha256.Sum256(raw)
		if got := hex.EncodeToString(sum[:]); got != artifact.SHA256 {
			t.Fatalf("%s hash = %s, want %s", name, artifact.SHA256, got)
		}
	}
	entries, err := filepath.Glob(filepath.Join(outcome.WorkDir, ".candidate-manifest-*.tmp"))
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
output=""
previous=""
for argument in "$@"; do
  if [ "$previous" = "-o" ]; then output="$argument"; break; fi
  previous="$argument"
done
[ -n "$output" ] || exit 92
cp "$CANDIDATE_VTT" "$(dirname "$output")/youtube-caption-download.en.vtt"
`)
	t.Setenv("CANDIDATE_METADATA", metadataPath)
	t.Setenv("CANDIDATE_VTT", vttPath)
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
