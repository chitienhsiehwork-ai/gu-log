package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/config"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/logx"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/pipeline"
)

func TestCandidateHelpContract(t *testing.T) {
	resetGlobals()
	cmd := buildRoot()
	var out bytes.Buffer
	cmd.SetOut(&out)
	cmd.SetErr(&out)
	cmd.SetArgs([]string{"candidate", "--help"})
	if err := cmd.Execute(); err != nil {
		t.Fatalf("candidate --help: %v", err)
	}
	help := out.String()
	for _, phrase := range []string{
		"yt-dlp",
		"candidate-manifest.json",
		"review-only",
		"never calls an LLM",
		"writeEligible is not approval",
		"gp-pipeline run <youtube-url>",
		"outside this repo",
	} {
		if !strings.Contains(help, phrase) {
			t.Errorf("candidate help missing contract phrase %q", phrase)
		}
	}
}

// healthyDoctorRepo returns a fake repo with every file doctor requires and a
// PATH holding every required binary except the ones named in skip.
func healthyDoctorRepo(t *testing.T, skip ...string) string {
	t.Helper()
	root := makeFakeRepo(t)
	cfg, err := config.Resolve(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, check := range doctorFileChecks(cfg, "legacy") {
		if _, err := os.Stat(check.Path); err == nil {
			continue
		}
		if err := os.MkdirAll(filepath.Dir(check.Path), 0o755); err != nil {
			t.Fatal(err)
		}
		mustWrite(t, check.Path, "fixture\n")
	}
	binDir := t.TempDir()
	for _, name := range requiredBinaries {
		if slices.Contains(skip, name) {
			continue
		}
		if err := os.WriteFile(filepath.Join(binDir, name), []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("PATH", binDir)
	t.Setenv("GU_LOG_DIR", root)
	return root
}

func runDoctorJSON(t *testing.T) (doctorReport, error) {
	t.Helper()
	resetGlobals()
	cmd := buildRoot()
	cmd.SetArgs([]string{"--json", "doctor"})
	raw, err := captureProcessStdout(t, func() error {
		return cmd.Execute()
	})
	var report doctorReport
	if jsonErr := json.Unmarshal(raw, &report); jsonErr != nil {
		t.Fatalf("parse doctor JSON: %v\n%s", jsonErr, raw)
	}
	return report, err
}

func TestDoctorJSONReportsMissingYTDLPAsOptionalCapability(t *testing.T) {
	healthyDoctorRepo(t)
	report, err := runDoctorJSON(t)
	if err != nil {
		t.Fatalf("doctor --json: %v", err)
	}
	if !report.OK {
		t.Fatalf("missing optional yt-dlp must not fail doctor: %#v", report)
	}
	var found bool
	for _, capability := range report.Capabilities {
		if capability.Name == "youtube-candidate" {
			found = true
			if capability.Available || capability.Dependency != "yt-dlp" {
				t.Fatalf("capability = %#v", capability)
			}
		}
	}
	if !found {
		t.Fatal("doctor JSON omitted youtube-candidate capability")
	}
}

func TestDoctorJSONFailsWhenRequiredDependencyIsMissing(t *testing.T) {
	t.Run("binary", func(t *testing.T) {
		healthyDoctorRepo(t, "pnpm")
		report, err := runDoctorJSON(t)
		if err == nil || exitCodeFor(err) != 1 {
			t.Fatalf("doctor --json without pnpm: err=%v, want exit code 1", err)
		}
		if report.OK || report.FailReason != "missing required binary: pnpm" {
			t.Fatalf("report = ok:%v failReason:%q", report.OK, report.FailReason)
		}
	})
	t.Run("file", func(t *testing.T) {
		root := healthyDoctorRepo(t)
		if err := os.Remove(filepath.Join(root, "scripts", "tribunal.sh")); err != nil {
			t.Fatal(err)
		}
		report, err := runDoctorJSON(t)
		if err == nil || exitCodeFor(err) != 1 {
			t.Fatalf("doctor --json without tribunal.sh: err=%v, want exit code 1", err)
		}
		if report.OK || report.FailReason != "missing required file: tribunal.sh" {
			t.Fatalf("report = ok:%v failReason:%q", report.OK, report.FailReason)
		}
	})
}

func TestDoctorHumanReportsYouTubeCapability(t *testing.T) {
	state := &rootState{log: logx.New()}
	report := doctorReport{
		GoVersion: "go-test",
		GoOS:      "test",
		GoArch:    "test",
		RepoRoot:  "/repo",
		OK:        true,
		Capabilities: []capabilityCheck{{
			Name:       "youtube-candidate",
			Available:  false,
			Dependency: "yt-dlp",
			Detail:     "YouTube candidate preflight is unavailable; install yt-dlp",
		}},
	}
	raw, err := captureProcessStdout(t, func() error {
		printDoctorHuman(state, report)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	human := string(raw)
	if !strings.Contains(human, "youtube-candidate") || !strings.Contains(human, "install yt-dlp") {
		t.Fatalf("human doctor omitted YouTube capability:\n%s", human)
	}
}

func TestDeployHelpContract(t *testing.T) {
	resetGlobals()
	cmd := buildRoot()
	var out bytes.Buffer
	cmd.SetOut(&out)
	cmd.SetErr(&out)
	cmd.SetArgs([]string{"deploy", "--help"})
	if err := cmd.Execute(); err != nil {
		t.Fatalf("deploy --help: %v", err)
	}
	help := out.String()

	for _, want := range []string{
		"fresh PENDING article",
		"--dry-run performs only CLI input preflight",
		"normal standalone deploy rejects them",
	} {
		if !strings.Contains(help, want) {
			t.Errorf("deploy help missing contract phrase %q", want)
		}
	}
	for _, flag := range []string{"--date-stamp", "--author-slug", "--title-slug"} {
		foundRequiredFlag := false
		for _, line := range strings.Split(help, "\n") {
			if strings.Contains(line, flag) && strings.Contains(line, "required for fresh PENDING deploy") {
				foundRequiredFlag = true
				break
			}
		}
		if !foundRequiredFlag {
			t.Errorf("deploy help must mark %s as required for fresh PENDING deploy", flag)
		}
	}

	mutations := map[string]int{
		"counter allocation": strings.Index(help, "allocate the counter"),
		"file rename":        strings.Index(help, "rename pending"),
	}
	for label, index := range mutations {
		if index < 0 {
			t.Fatalf("deploy help missing %s contract", label)
		}
	}
	for label, phrase := range map[string]string{
		"CLI input":    "validates CLI inputs",
		"taxonomy":     "canonical taxonomy",
		"frontmatter":  "PENDING ticketId",
		"staged index": "pre-existing staged index changes",
		"validator":    "node scripts/validate-posts.mjs",
	} {
		gate := strings.Index(help, phrase)
		if gate < 0 {
			t.Errorf("deploy help missing %s gate phrase %q", label, phrase)
			continue
		}
		for mutationLabel, mutation := range mutations {
			if gate > mutation {
				t.Errorf("deploy help must list %s gate before %s; gate=%d mutation=%d", label, mutationLabel, gate, mutation)
			}
		}
	}
}

func TestSkillRecoveryContract(t *testing.T) {
	skillPath := filepath.Join("..", "..", "SKILL.md")
	raw, err := os.ReadFile(skillPath)
	if err != nil {
		t.Fatalf("read %s: %v", skillPath, err)
	}
	skill := string(raw)

	// The exit code list lives in `run --help` (built from the constants); the
	// skill points there instead of keeping a second table.
	if strings.Contains(skill, "| Code |") {
		t.Error("skill still keeps its own exit code table; point to `run --help` instead")
	}
	// The GP translation flow is retired (openspec: gp-source-preservation) and
	// GP is no longer paused: the skill must not route agents back to either.
	for _, retired := range []string{"legacy-shadow", "source-translate", "source-preservation", "gp-publish-gate", "GP 暫停中"} {
		if strings.Contains(skill, retired) {
			t.Errorf("skill still documents the retired GP translation flow or the GP pause: %q", retired)
		}
	}

	for _, line := range strings.Split(skill, "\n") {
		if strings.HasPrefix(line, "|") && strings.Contains(line, "恢復") && strings.Contains(line, "`gp-pipeline deploy") {
			t.Errorf("recovery table row must not route through standalone deploy: %s", line)
		}
	}
}

// TestHelpDescribesNoGPOnlySteps: GP is a promoted MP, so the help describes
// no GP-only step (the retired reading-guide flow and its stamp), points GP to
// scripts/reclassify-post.mjs, and no longer says GP is paused.
func TestHelpDescribesNoGPOnlySteps(t *testing.T) {
	help := func(args ...string) string {
		resetGlobals()
		cmd := buildRoot()
		var out bytes.Buffer
		cmd.SetOut(&out)
		cmd.SetErr(&out)
		cmd.SetArgs(append(args, "--help"))
		if err := cmd.Execute(); err != nil {
			t.Fatalf("%v --help: %v", args, err)
		}
		return out.String()
	}
	for _, args := range [][]string{{}, {"run"}, {"ralph"}, {"translate"}, {"eval"}} {
		out := help(args...)
		for _, retired := range []string{"source-distance", "reading guide", "post-fixer", "score-only", "aligner", "englishSkipped", "GP-worthy"} {
			if strings.Contains(out, retired) {
				t.Errorf("%v help still describes the retired GP flow: %q", args, retired)
			}
		}
	}
	for _, args := range [][]string{{}, {"run"}} {
		if out := help(args...); !strings.Contains(out, pipeline.ReclassifyScript) {
			t.Errorf("%v help does not say GP is promoted with %s", args, pipeline.ReclassifyScript)
		}
	}
	if err := executeCLI(t, "stamp", "--file", "gp-10-example.mdx"); err == nil || !strings.Contains(err.Error(), "unknown command") {
		t.Errorf("stamp error = %v, want an unknown command", err)
	}
	for _, args := range [][]string{{}, {"run"}, {"counter"}, {"write"}, {"review"}, {"refine"}, {"deploy"}} {
		out := help(args...)
		for _, stale := range []string{"暫停", "paused", "default GP", "defaults to GP"} {
			if strings.Contains(out, stale) {
				t.Errorf("%v help still says %q", args, stale)
			}
		}
	}
}
