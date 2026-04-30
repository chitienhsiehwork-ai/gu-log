package runner

import (
	"context"
	"errors"
	"os/exec"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestRun_OK(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("posix-only echo command")
	}
	ctx := context.Background()
	res, err := Run(ctx, "echo", "hello")
	if err != nil {
		t.Fatalf("Run(echo) returned error: %v", err)
	}
	if res.ExitCode != 0 {
		t.Fatalf("exit = %d, want 0", res.ExitCode)
	}
	if !strings.Contains(string(res.Stdout), "hello") {
		t.Fatalf("stdout = %q, want to contain 'hello'", res.Stdout)
	}
}

func TestRun_NonZeroExitWrappedAsExitError(t *testing.T) {
	ctx := context.Background()
	res, err := Run(ctx, "sh", "-c", "echo oops 1>&2; exit 7")
	if err == nil {
		t.Fatal("expected error for non-zero exit")
	}
	if res.ExitCode != 7 {
		t.Fatalf("exit = %d, want 7", res.ExitCode)
	}
	if !strings.Contains(err.Error(), "code 7") {
		t.Fatalf("error message missing exit code: %v", err)
	}
	if !strings.Contains(string(res.Stderr), "oops") {
		t.Fatalf("stderr not captured: %q", res.Stderr)
	}
}

func TestRun_BinaryNotFound(t *testing.T) {
	ctx := context.Background()
	_, err := Run(ctx, "this-binary-definitely-does-not-exist-xyz123")
	if err == nil {
		t.Fatal("expected error for missing binary")
	}
	// Should NOT be an *exec.ExitError — process never started.
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		t.Fatalf("got ExitError for missing binary, want generic run error")
	}
}

func TestRun_ContextCanceled(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	_, err := Run(ctx, "sleep", "5")
	if err == nil {
		t.Fatal("expected error from context timeout")
	}
}

func TestRunWithStdin(t *testing.T) {
	ctx := context.Background()
	res, err := RunWithStdin(ctx, []byte("hello stdin"), "cat")
	if err != nil {
		t.Fatalf("cat with stdin failed: %v", err)
	}
	if string(res.Stdout) != "hello stdin" {
		t.Fatalf("stdout = %q, want %q", res.Stdout, "hello stdin")
	}
}

func TestRunWithOptions_WorkDir(t *testing.T) {
	ctx := context.Background()
	res, err := RunWithOptions(ctx, Options{
		Name:    "pwd",
		WorkDir: "/tmp",
	})
	if err != nil {
		t.Fatalf("pwd failed: %v", err)
	}
	if !strings.Contains(string(res.Stdout), "/tmp") {
		t.Fatalf("stdout = %q, want it to contain /tmp", res.Stdout)
	}
}

func TestLookPath(t *testing.T) {
	if _, err := LookPath("sh"); err != nil {
		t.Fatalf("LookPath(sh) failed: %v", err)
	}
	if _, err := LookPath("definitely-missing-cmd-xyz"); err == nil {
		t.Fatal("LookPath should fail for missing command")
	}
}

func TestTrimStderr(t *testing.T) {
	got := trimStderr([]byte("  hello world  \n"))
	if got != "hello world" {
		t.Fatalf("trimStderr = %q, want trimmed", got)
	}

	long := strings.Repeat("x", 1000)
	out := trimStderr([]byte(long))
	if !strings.HasSuffix(out, "...(truncated)") {
		t.Fatalf("expected truncation marker, got %q", out[len(out)-30:])
	}
}
