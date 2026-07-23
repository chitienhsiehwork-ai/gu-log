package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"

	candidatepkg "github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/candidate"
)

func TestRunRejectsUnsupportedYouTubeOwnedHostsBeforeFetchOrProvider(t *testing.T) {
	repo := makeFakeRepo(t)
	trapDir := t.TempDir()
	trapLog := filepath.Join(t.TempDir(), "trap.log")
	for _, name := range []string{"curl", "yt-dlp", "codex", "claude", "gh", "vercel"} {
		writeExecutableFile(t, filepath.Join(trapDir, name), `#!/bin/sh
printf '%s\n' "$0 $*" >> "$CANDIDATE_SECURITY_TRAP_LOG"
exit 99
`)
	}
	t.Setenv("GU_LOG_DIR", resolvedTestPath(t, repo))
	t.Setenv("CANDIDATE_SECURITY_TRAP_LOG", trapLog)
	t.Setenv("PATH", trapDir+string(os.PathListSeparator)+os.Getenv("PATH"))

	for _, rawURL := range []string{
		"https://m.youtube.com/watch?v=dQw4w9WgXcQ",
		"https://music.youtube.com/watch?v=dQw4w9WgXcQ",
		"https://youtube-nocookie.com/embed/dQw4w9WgXcQ",
	} {
		resetGlobals()
		cmd := buildRoot()
		cmd.SetArgs([]string{"run", rawURL, "--prefix", "GP"})
		err := cmd.Execute()
		if err == nil || !strings.Contains(err.Error(), "invalid YouTube URL") {
			t.Fatalf("run %s error = %v", rawURL, err)
		}
	}
	if raw, err := os.ReadFile(trapLog); err == nil {
		t.Fatalf("unsupported owned host invoked fetch/provider tooling:\n%s", raw)
	} else if !os.IsNotExist(err) {
		t.Fatal(err)
	}
}

func TestCandidateCobraPreservesArtifactFailedExitTenAndManifest(t *testing.T) {
	repo := makeFakeRepo(t)
	script := `import fs from 'fs';
import path from 'path';
for (const name of fs.readdirSync(process.env.CANDIDATE_PARENT)) {
  if (!name.startsWith('gp-candidate-')) continue;
  const artifact = path.join(process.env.CANDIDATE_PARENT, name, 'source-tweet.md');
  if (fs.existsSync(artifact)) fs.unlinkSync(artifact);
}
process.stdout.write('PASS\n');
`
	mustWrite(t, filepath.Join(repo, "scripts", "dedup-gate.mjs"), script)
	parent := t.TempDir()
	binDir := installCobraYTDLP(t)
	t.Setenv("GU_LOG_DIR", resolvedTestPath(t, repo))
	t.Setenv("CANDIDATE_PARENT", parent)
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))

	resetGlobals()
	cmd := buildRoot()
	cmd.SetArgs([]string{"--work-dir", parent, "candidate", "https://youtu.be/dQw4w9WgXcQ"})
	err := cmd.Execute()
	if got := exitCodeFor(err); got != 10 {
		t.Fatalf("candidate exit = %d, want 10; error=%v", got, err)
	}
	manifest := readOnlyCandidateManifest(t, parent)
	if manifest.Failure == nil || manifest.Failure.Code != "artifact_failed" {
		t.Fatalf("failure = %#v, want artifact_failed", manifest.Failure)
	}
	if manifest.WriteEligible {
		t.Fatal("artifact failure must clear writeEligible")
	}
}

func TestCandidateCobraRealDedupLoaderBlocksSourceURLAliasesWithExitThirteen(t *testing.T) {
	repo := makeFakeRepo(t)
	installRealDedupFixture(t, repo, true)
	binDir := installCobraYTDLP(t)
	t.Setenv("GU_LOG_DIR", resolvedTestPath(t, repo))
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))

	for _, rawURL := range []string{
		"https://youtube.com/shorts/dQw4w9WgXcQ",
		"https://youtu.be/dQw4w9WgXcQ",
	} {
		t.Run(rawURL, func(t *testing.T) {
			parent := t.TempDir()
			resetGlobals()
			cmd := buildRoot()
			cmd.SetArgs([]string{"--work-dir", parent, "candidate", rawURL})
			err := cmd.Execute()
			if got := exitCodeFor(err); got != 13 {
				t.Fatalf("candidate exit = %d, want 13; error=%v", got, err)
			}
			manifest := readOnlyCandidateManifest(t, parent)
			if manifest.Dedup.Verdict != "BLOCK" || len(manifest.Dedup.Matches) == 0 {
				t.Fatalf("dedup = %#v, want BLOCK with a recorded match", manifest.Dedup)
			}
			match := strings.ToLower(strings.Join(manifest.Dedup.Matches, "\n"))
			if !strings.Contains(match, "gp-42") || !strings.Contains(match, "youtube video id match") {
				t.Fatalf("dedup match does not prove sourceUrl identity: %#v", manifest.Dedup.Matches)
			}
		})
	}
}

func TestCandidateCobraDoesNotMutateFullRepoSnapshotOrInvokeTraps(t *testing.T) {
	gitPath, err := exec.LookPath("git")
	if err != nil {
		t.Fatal(err)
	}
	repo := makeFakeRepo(t)
	installRealDedupFixture(t, repo, false)
	mustWrite(t, filepath.Join(repo, ".gitignore"), "node_modules\nignored-*\n")
	mustWrite(t, filepath.Join(repo, "tracked.txt"), "tracked sentinel\n")
	if err := os.Symlink("tracked.txt", filepath.Join(repo, "tracked-link")); err != nil {
		t.Fatal(err)
	}
	runAbsoluteGit(t, gitPath, repo, "init", "-q")
	runAbsoluteGit(t, gitPath, repo, "config", "user.name", "Candidate Test")
	runAbsoluteGit(t, gitPath, repo, "config", "user.email", "candidate@example.invalid")
	runAbsoluteGit(t, gitPath, repo, "add", ".")
	runAbsoluteGit(t, gitPath, repo, "commit", "-qm", "fixture")
	mustWriteMode(t, filepath.Join(repo, "untracked.txt"), "untracked sentinel\n", 0o600)
	if err := os.Symlink("untracked.txt", filepath.Join(repo, "untracked-link")); err != nil {
		t.Fatal(err)
	}
	mustWriteMode(t, filepath.Join(repo, "ignored-file"), "ignored sentinel\n", 0o640)
	if err := os.Symlink("ignored-file", filepath.Join(repo, "ignored-link")); err != nil {
		t.Fatal(err)
	}
	before := snapshotFullRepo(t, gitPath, repo)

	parent := t.TempDir()
	binDir := installCobraYTDLP(t)
	trapLog := filepath.Join(parent, "trap.log")
	for _, name := range []string{
		"git", "codex", "claude", "gemini", "openai", "gh", "vercel",
		"npm", "npx", "pnpm", "bun", "astro",
	} {
		writeExecutableFile(t, filepath.Join(binDir, name), `#!/bin/sh
printf '%s\n' "$0 $*" >> "$CANDIDATE_SECURITY_TRAP_LOG"
exit 99
`)
	}
	t.Setenv("GU_LOG_DIR", resolvedTestPath(t, repo))
	t.Setenv("CANDIDATE_SECURITY_TRAP_LOG", trapLog)
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))

	resetGlobals()
	cmd := buildRoot()
	cmd.SetArgs([]string{"--work-dir", parent, "candidate", "https://youtube.com/watch?v=dQw4w9WgXcQ"})
	if err := cmd.Execute(); err != nil {
		t.Fatalf("candidate command: %v", err)
	}
	after := snapshotFullRepo(t, gitPath, repo)
	if !reflect.DeepEqual(before, after) {
		t.Fatalf("repo snapshot changed\nbefore=%#v\nafter=%#v", before, after)
	}
	if raw, err := os.ReadFile(trapLog); err == nil {
		t.Fatalf("candidate invoked forbidden command:\n%s", raw)
	} else if !os.IsNotExist(err) {
		t.Fatal(err)
	}
}

type fullRepoSnapshot struct {
	HeadCommit string
	HeadFile   fileIdentity
	Refs       string
	Index      fileIdentity
	Tracked    map[string]fileIdentity
	Untracked  map[string]fileIdentity
	Ignored    map[string]fileIdentity
}

type fileIdentity struct {
	Mode       fs.FileMode
	Hash       string
	LinkTarget string
}

func snapshotFullRepo(t *testing.T, gitPath, repo string) fullRepoSnapshot {
	t.Helper()
	return fullRepoSnapshot{
		HeadCommit: strings.TrimSpace(string(runAbsoluteGitBytes(t, gitPath, repo, "rev-parse", "HEAD"))),
		HeadFile:   snapshotOnePath(t, filepath.Join(repo, ".git", "HEAD")),
		Refs:       string(runAbsoluteGitBytes(t, gitPath, repo, "show-ref")),
		Index:      snapshotOnePath(t, filepath.Join(repo, ".git", "index")),
		Tracked: snapshotRepoPaths(
			t, repo, nulSeparated(runAbsoluteGitBytes(t, gitPath, repo, "ls-files", "-z")),
		),
		Untracked: snapshotRepoPaths(
			t, repo, nulSeparated(runAbsoluteGitBytes(t, gitPath, repo, "ls-files", "--others", "--exclude-standard", "-z")),
		),
		Ignored: snapshotRepoPaths(
			t, repo, nulSeparated(runAbsoluteGitBytes(t, gitPath, repo, "ls-files", "--others", "--ignored", "--exclude-standard", "-z")),
		),
	}
}

func snapshotRepoPaths(t *testing.T, repo string, paths []string) map[string]fileIdentity {
	t.Helper()
	sort.Strings(paths)
	result := make(map[string]fileIdentity, len(paths))
	for _, relative := range paths {
		result[relative] = snapshotOnePath(t, filepath.Join(repo, relative))
	}
	return result
}

func snapshotOnePath(t *testing.T, path string) fileIdentity {
	t.Helper()
	info, err := os.Lstat(path)
	if err != nil {
		t.Fatal(err)
	}
	identity := fileIdentity{Mode: info.Mode()}
	var raw []byte
	if info.Mode()&os.ModeSymlink != 0 {
		target, err := os.Readlink(path)
		if err != nil {
			t.Fatal(err)
		}
		identity.LinkTarget = target
		raw = []byte(target)
	} else {
		raw, err = os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
	}
	sum := sha256.Sum256(raw)
	identity.Hash = hex.EncodeToString(sum[:])
	return identity
}

func nulSeparated(raw []byte) []string {
	var result []string
	for _, item := range bytes.Split(raw, []byte{0}) {
		if len(item) > 0 {
			result = append(result, string(item))
		}
	}
	return result
}

func installRealDedupFixture(t *testing.T, repo string, withDuplicate bool) {
	t.Helper()
	realRepo, err := filepath.Abs(filepath.Join("..", "..", "..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	script, err := os.ReadFile(filepath.Join(realRepo, "scripts", "dedup-gate.mjs"))
	if err != nil {
		t.Fatal(err)
	}
	mustWrite(t, filepath.Join(repo, "scripts", "dedup-gate.mjs"), string(script))
	if err := os.Symlink(filepath.Join(realRepo, "node_modules"), filepath.Join(repo, "node_modules")); err != nil {
		t.Fatal(err)
	}
	postsDir := filepath.Join(repo, "src", "content", "posts")
	if err := os.MkdirAll(postsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if withDuplicate {
		mustWrite(t, filepath.Join(postsDir, "gp-42-existing.mdx"), `---
ticketId: GP-42
title: Existing video
sourceUrl: https://www.youtube.com/watch?v=dQw4w9WgXcQ
tags:
  - youtube
---

Existing body.
`)
	}
}

func installCobraYTDLP(t *testing.T) string {
	t.Helper()
	fixtures := t.TempDir()
	metadata := filepath.Join(fixtures, "metadata.json")
	vtt := filepath.Join(fixtures, "fixture.vtt")
	mustWrite(t, metadata, `{
  "id": "dQw4w9WgXcQ",
  "title": "Candidate source",
  "channel": "Fixture channel",
  "upload_date": "20260722",
  "duration": 600,
  "subtitles": {"en": [{"ext": "vtt"}]}
}`)
	mustWrite(t, vtt, "WEBVTT\n\n00:00:00.000 --> 00:01:00.000\n"+strings.Repeat("word ", 240)+"\n")
	binDir := t.TempDir()
	writeExecutableFile(t, filepath.Join(binDir, "yt-dlp"), `#!/bin/sh
case " $* " in
  *" --no-playlist "*) ;;
  *) exit 91 ;;
esac
case " $* " in
  *" -J "*) cat "$COBRA_YTDLP_METADATA"; exit 0 ;;
esac
output=""
previous=""
for argument in "$@"; do
  if [ "$previous" = "-o" ]; then output="$argument"; break; fi
  previous="$argument"
done
[ -n "$output" ] || exit 92
cp "$COBRA_YTDLP_VTT" "$(dirname "$output")/youtube-caption-download.en.vtt"
`)
	t.Setenv("COBRA_YTDLP_METADATA", metadata)
	t.Setenv("COBRA_YTDLP_VTT", vtt)
	return binDir
}

func readOnlyCandidateManifest(t *testing.T, parent string) *candidatepkg.Manifest {
	t.Helper()
	matches, err := filepath.Glob(filepath.Join(parent, "gp-candidate-*", candidatepkg.ManifestFilename))
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 1 {
		t.Fatalf("manifest matches = %v, want exactly one", matches)
	}
	raw, err := os.ReadFile(matches[0])
	if err != nil {
		t.Fatal(err)
	}
	var manifest candidatepkg.Manifest
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatal(err)
	}
	return &manifest
}

func writeExecutableFile(t *testing.T, path, body string) {
	t.Helper()
	mustWriteMode(t, path, body, 0o755)
}

func mustWriteMode(t *testing.T, path, body string, mode fs.FileMode) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), mode); err != nil {
		t.Fatal(err)
	}
}

func runAbsoluteGit(t *testing.T, gitPath, repo string, args ...string) {
	t.Helper()
	_ = runAbsoluteGitBytes(t, gitPath, repo, args...)
}

func runAbsoluteGitBytes(t *testing.T, gitPath, repo string, args ...string) []byte {
	t.Helper()
	command := exec.Command(gitPath, args...)
	command.Dir = repo
	output, err := command.Output()
	if err != nil {
		t.Fatalf("git %v: %v", args, err)
	}
	return output
}

func resolvedTestPath(t *testing.T, path string) string {
	t.Helper()
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		t.Fatal(err)
	}
	return resolved
}
