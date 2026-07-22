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
