package ralph

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func writeStubScript(t *testing.T, dir, body string) string {
	t.Helper()
	p := filepath.Join(dir, "fake-tribunal.sh")
	if err := os.WriteFile(p, []byte("#!/bin/bash\n"+body+"\n"), 0o755); err != nil {
		t.Fatalf("write stub script: %v", err)
	}
	return p
}

// Spec: openspec/specs/publish-bar-visibility/spec.md
// Scenario「Tribunal FAIL is advisory to the pipeline」— tribunal exit 1 是
// business outcome 不是 error：Run 必須回 (passed=false, err=nil)，讓
// pipeline 記 warning 後繼續 best-effort deploy。
func TestRunTreatsTribunalFailAsAdvisory(t *testing.T) {
	dir := t.TempDir()
	script := writeStubScript(t, dir, "echo 'tribunal FAIL'; exit 1")

	passed, err := Run(context.Background(), Options{
		RalphScript: script,
		Filename:    "sp-000-test.mdx",
		StdoutFile:  filepath.Join(dir, "tribunal-stdout.txt"),
	})
	if err != nil {
		t.Fatalf("tribunal exit 1 must be advisory (err=nil), got err: %v", err)
	}
	if passed {
		t.Fatal("tribunal exit 1 must report passed=false")
	}
}

func TestRunReportsPassOnCleanExit(t *testing.T) {
	dir := t.TempDir()
	script := writeStubScript(t, dir, "echo 'tribunal PASS'; exit 0")

	passed, err := Run(context.Background(), Options{
		RalphScript: script,
		Filename:    "sp-000-test.mdx",
		StdoutFile:  filepath.Join(dir, "tribunal-stdout.txt"),
	})
	if err != nil {
		t.Fatalf("clean exit must return err=nil, got: %v", err)
	}
	if !passed {
		t.Fatal("clean exit must report passed=true")
	}
}
