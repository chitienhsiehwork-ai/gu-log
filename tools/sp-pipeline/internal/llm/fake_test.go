package llm

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestFakeProvider_Queue(t *testing.T) {
	ctx := context.Background()
	fp := NewFakeClaude().WithResponses(
		FakeResponse{Output: "one"},
		FakeResponse{Output: "two"},
	)
	out, err := fp.Run(ctx, "prompt A", RunOptions{})
	if err != nil || out != "one" {
		t.Fatalf("first pop: out=%q err=%v", out, err)
	}
	out, err = fp.Run(ctx, "prompt B", RunOptions{})
	if err != nil || out != "two" {
		t.Fatalf("second pop: out=%q err=%v", out, err)
	}
	if _, err := fp.Run(ctx, "empty", RunOptions{}); err != ErrQueueEmpty {
		t.Fatalf("third pop: expected ErrQueueEmpty, got %v", err)
	}
	if len(fp.Called) != 3 {
		t.Errorf("expected 3 Called entries, got %d", len(fp.Called))
	}
	if fp.Called[1].Prompt != "prompt B" {
		t.Errorf("Called[1].Prompt = %q, want %q", fp.Called[1].Prompt, "prompt B")
	}
}

func TestFakeProvider_WriteFile(t *testing.T) {
	ctx := context.Background()
	workDir := t.TempDir()
	fp := NewFakeClaude().WithResponses(
		FakeResponse{
			Output:    `{"verdict":"GO","reason":"fake"}`,
			WriteFile: "eval-gemini.json",
		},
	)
	out, err := fp.Run(ctx, "prompt", RunOptions{WorkDir: workDir})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if out != `{"verdict":"GO","reason":"fake"}` {
		t.Errorf("unexpected output %q", out)
	}
	data, err := os.ReadFile(filepath.Join(workDir, "eval-gemini.json"))
	if err != nil {
		t.Fatalf("fake should have created eval-gemini.json: %v", err)
	}
	if string(data) != `{"verdict":"GO","reason":"fake"}` {
		t.Errorf("file contents mismatch: %q", data)
	}
}

func TestFakeProvider_Err(t *testing.T) {
	fp := NewFakeClaude().WithResponses(
		FakeResponse{Output: "", Err: "boom"},
	)
	_, err := fp.Run(context.Background(), "prompt", RunOptions{})
	if err == nil || err.Error() != "boom" {
		t.Errorf("expected boom, got %v", err)
	}
}

func TestLoadFakeFromJSON(t *testing.T) {
	path := filepath.Join(t.TempDir(), "spec.json")
	raw := `{
      "responses": [
        {"output": "{\"verdict\":\"GO\"}", "writeFile": "eval-gemini.json"},
        {"output": "{\"verdict\":\"GO\"}", "writeFile": "eval-codex.json"}
      ]
    }`
	if err := os.WriteFile(path, []byte(raw), 0o644); err != nil {
		t.Fatalf("write spec: %v", err)
	}
	fp, err := LoadFakeFromJSON(path)
	if err != nil {
		t.Fatalf("LoadFakeFromJSON: %v", err)
	}
	if len(fp.Responses) != 2 {
		t.Errorf("expected 2 responses, got %d", len(fp.Responses))
	}
	if fp.Responses[0].WriteFile != "eval-gemini.json" {
		t.Errorf("first response WriteFile wrong: %q", fp.Responses[0].WriteFile)
	}
}

func TestSanitizeCodexJSON(t *testing.T) {
	cases := []struct {
		name    string
		input   string
		wantOK  bool
		wantSub string
	}{
		{
			name:    "clean json",
			input:   `{"verdict":"GO","reason":"looks good"}`,
			wantOK:  true,
			wantSub: `"verdict":"GO"`,
		},
		{
			name: "json then garbage",
			input: `{"verdict":"SKIP","reason":"thin"}
[codex] used 341 tokens
[codex] done
`,
			wantOK:  true,
			wantSub: `"verdict":"SKIP"`,
		},
		{
			name: "preamble then json",
			input: `[codex] starting...
ignored line
{"verdict":"GO","reason":"depth"}`,
			wantOK:  true,
			wantSub: `"verdict":"GO"`,
		},
		{
			name:    "no json at all",
			input:   "this is just log output\nwith no json object",
			wantOK:  false,
			wantSub: "",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			out, ok := SanitizeCodexJSON([]byte(tc.input))
			if ok != tc.wantOK {
				t.Fatalf("ok = %v, want %v (out=%q)", ok, tc.wantOK, out)
			}
			if tc.wantOK && !contains(out, tc.wantSub) {
				t.Errorf("output %q does not contain %q", out, tc.wantSub)
			}
		})
	}
}

func contains(haystack []byte, needle string) bool {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if string(haystack[i:i+len(needle)]) == needle {
			return true
		}
	}
	return false
}
