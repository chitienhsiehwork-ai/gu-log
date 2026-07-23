package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/logx"
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

func TestDoctorJSONReportsMissingYTDLPAsOptionalCapability(t *testing.T) {
	root := makeFakeRepo(t)
	mustWrite(t, filepath.Join(root, "scripts", "fetch-x-article.sh"), "#!/bin/sh\n")
	mustWrite(t, filepath.Join(root, "scripts", "validate-posts.mjs"), "// fixture\n")
	binDir := t.TempDir()
	for _, name := range requiredBinaries {
		if err := os.WriteFile(filepath.Join(binDir, name), []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("PATH", binDir)
	t.Setenv("GU_LOG_DIR", root)

	resetGlobals()
	cmd := buildRoot()
	cmd.SetArgs([]string{"--json", "doctor"})
	raw, err := captureProcessStdout(t, func() error {
		return cmd.Execute()
	})
	if err != nil {
		t.Fatalf("doctor --json: %v\n%s", err, raw)
	}
	var report doctorReport
	if err := json.Unmarshal(raw, &report); err != nil {
		t.Fatalf("parse doctor JSON: %v\n%s", err, raw)
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

	for _, want := range []string{
		"run --from-step translate --file <existing>.mdx",
		"run --from-step deploy --file <existing>.mdx",
		"--date-stamp <YYYYMMDD> --author-slug <author> --title-slug <title>",
		"AGENTS.md",
		"detect-env.sh --runtime <codex|claude-code>",
	} {
		if !strings.Contains(skill, want) {
			t.Errorf("skill missing recovery contract %q", want)
		}
	}

	for _, line := range strings.Split(skill, "\n") {
		if strings.HasPrefix(line, "|") && strings.Contains(line, "恢復") && strings.Contains(line, "`gp-pipeline deploy") {
			t.Errorf("recovery table row must not route through standalone deploy: %s", line)
		}
	}
}
