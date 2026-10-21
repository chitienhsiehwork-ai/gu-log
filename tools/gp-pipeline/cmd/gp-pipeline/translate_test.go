package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDefaultTranslateWorkDirIsUniquePerRun(t *testing.T) {
	t.Setenv("TMPDIR", t.TempDir())
	const file = "mp-116-20260220-example.mdx"

	first, err := defaultTranslateWorkDir(file)
	if err != nil {
		t.Fatalf("first: %v", err)
	}
	second, err := defaultTranslateWorkDir(file)
	if err != nil {
		t.Fatalf("second: %v", err)
	}
	if first == second {
		t.Fatalf("two runs share work dir %s", first)
	}
	for _, dir := range []string{first, second} {
		if info, err := os.Stat(dir); err != nil || !info.IsDir() {
			t.Fatalf("work dir %s not created: %v", dir, err)
		}
		if !strings.HasPrefix(filepath.Base(dir), "gp-translate-mp-116-20260220-example-") {
			t.Fatalf("work dir %s does not carry the file stem", dir)
		}
	}
}
