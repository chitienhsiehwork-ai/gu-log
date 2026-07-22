package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

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
		"required --date-stamp, --author-slug",
		"--title-slug filename slots",
		"testing-only flags",
		"dry-run returns",
	} {
		if !strings.Contains(help, want) {
			t.Errorf("deploy help missing contract phrase %q", want)
		}
	}

	validator := strings.Index(help, "Runs node scripts/validate-posts.mjs")
	counterBump := strings.Index(help, "Bumps the GP/MP/SD/Lv counter")
	if validator < 0 || counterBump < 0 || validator > counterBump {
		t.Errorf("deploy help must list validator before counter bump; validator=%d counter=%d", validator, counterBump)
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

	if strings.Contains(skill, "| 恢復 deploy | `gp-pipeline deploy") {
		t.Error("skill still routes ambiguous recovery through standalone deploy")
	}
}
