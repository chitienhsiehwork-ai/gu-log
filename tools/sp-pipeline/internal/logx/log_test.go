package logx

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func newTestLogger(buf *bytes.Buffer) *Logger {
	return &Logger{out: buf, colors: false}
}

func TestEmit_HumanFormat(t *testing.T) {
	var buf bytes.Buffer
	l := newTestLogger(&buf)
	l.Info("hello %s", "world")
	out := buf.String()
	if !strings.HasPrefix(out, "[INFO] ") {
		t.Fatalf("missing [INFO] prefix: %q", out)
	}
	if !strings.Contains(out, "hello world") {
		t.Fatalf("missing formatted args: %q", out)
	}
}

func TestEmit_AllLevelsHaveTags(t *testing.T) {
	cases := []struct {
		level Level
		tag   string
	}{
		{LevelInfo, "[INFO]"},
		{LevelOK, "[OK]"},
		{LevelWarn, "[WARN]"},
		{LevelError, "[ERROR]"},
	}
	for _, tc := range cases {
		if got := tagFor(tc.level); got != tc.tag {
			t.Fatalf("tagFor(%s) = %q, want %q", tc.level, got, tc.tag)
		}
	}
	if got := tagFor("mystery"); got != "[?]" {
		t.Fatalf("unknown level tag = %q, want [?]", got)
	}
}

func TestEmit_JSONMode(t *testing.T) {
	var buf bytes.Buffer
	l := newTestLogger(&buf)
	l.SetJSON(true)
	l.OK("done %d", 7)

	var rec struct {
		Time  string `json:"time"`
		Level string `json:"level"`
		Msg   string `json:"msg"`
	}
	if err := json.Unmarshal(buf.Bytes(), &rec); err != nil {
		t.Fatalf("invalid JSON: %v (raw=%q)", err, buf.String())
	}
	if rec.Level != "ok" {
		t.Fatalf("level = %q, want ok", rec.Level)
	}
	if rec.Msg != "done 7" {
		t.Fatalf("msg = %q, want 'done 7'", rec.Msg)
	}
	if rec.Time == "" {
		t.Fatalf("time field missing")
	}
}

func TestSetJSON_DisablesColors(t *testing.T) {
	l := &Logger{colors: true}
	l.SetJSON(true)
	if l.colors {
		t.Fatal("SetJSON(true) should disable colors")
	}
}

func TestVerbose(t *testing.T) {
	l := New()
	if l.Verbose() {
		t.Fatal("default verbose should be false")
	}
	l.SetVerbose(true)
	if !l.Verbose() {
		t.Fatal("Verbose() should return true after SetVerbose(true)")
	}
}

func TestColorFor(t *testing.T) {
	if colorFor(LevelInfo) != ansiBlue {
		t.Fatal("info color")
	}
	if colorFor(LevelOK) != ansiGreen {
		t.Fatal("ok color")
	}
	if colorFor(LevelWarn) != ansiYellow {
		t.Fatal("warn color")
	}
	if colorFor(LevelError) != ansiRed {
		t.Fatal("error color")
	}
	if colorFor("unknown") != "" {
		t.Fatal("unknown color should be empty")
	}
}

func TestNew_DefaultsToStderr(t *testing.T) {
	l := New()
	if l == nil {
		t.Fatal("New() returned nil")
	}
	if l.json {
		t.Fatal("default json mode should be false")
	}
}
