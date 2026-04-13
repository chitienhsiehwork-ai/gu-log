// Package logx is the minimal structured logger used by sp-pipeline.
//
// Two output modes: human (colored, matches the existing bash script's
// [INFO]/[OK]/[WARN]/[ERROR] prefix convention so dashboards and humans that
// grep for those tags keep working), and JSON (one object per line on stderr,
// chosen with --json on the root command). The JSON shape is stable — see
// SKILL.md for the schema.
package logx

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"sync"
	"time"
)

// Level is one of: info, ok, warn, error.
type Level string

const (
	LevelInfo  Level = "info"
	LevelOK    Level = "ok"
	LevelWarn  Level = "warn"
	LevelError Level = "error"
)

// ANSI color escape sequences. We write them straight to stderr only when the
// destination is a TTY and we are NOT in JSON mode. No dependency on a color
// library — the four colors we need do not justify one.
const (
	ansiReset  = "\033[0m"
	ansiBlue   = "\033[0;34m"
	ansiGreen  = "\033[0;32m"
	ansiYellow = "\033[1;33m"
	ansiRed    = "\033[0;31m"
)

// Logger is goroutine-safe.
type Logger struct {
	mu      sync.Mutex
	out     io.Writer
	json    bool
	colors  bool
	verbose bool
}

// New returns a Logger writing to stderr with auto-detected color support.
func New() *Logger {
	return &Logger{
		out:    os.Stderr,
		colors: isTerminal(os.Stderr),
	}
}

// SetJSON toggles JSON output mode. When true, every log call emits a JSON
// object on stderr and colors are suppressed.
func (l *Logger) SetJSON(v bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.json = v
	if v {
		l.colors = false
	}
}

// SetVerbose toggles verbose mode. When false, Info and OK are still emitted
// but extra debug events (reserved for future use) are suppressed.
func (l *Logger) SetVerbose(v bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.verbose = v
}

// Verbose reports whether verbose mode is on.
func (l *Logger) Verbose() bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.verbose
}

// Info logs at LevelInfo.
func (l *Logger) Info(format string, args ...any) { l.emit(LevelInfo, format, args...) }

// OK logs at LevelOK.
func (l *Logger) OK(format string, args ...any) { l.emit(LevelOK, format, args...) }

// Warn logs at LevelWarn.
func (l *Logger) Warn(format string, args ...any) { l.emit(LevelWarn, format, args...) }

// Error logs at LevelError.
func (l *Logger) Error(format string, args ...any) { l.emit(LevelError, format, args...) }

func (l *Logger) emit(level Level, format string, args ...any) {
	msg := fmt.Sprintf(format, args...)
	l.mu.Lock()
	defer l.mu.Unlock()

	if l.json {
		rec := struct {
			Time  string `json:"time"`
			Level Level  `json:"level"`
			Msg   string `json:"msg"`
		}{
			Time:  time.Now().UTC().Format(time.RFC3339),
			Level: level,
			Msg:   msg,
		}
		_ = json.NewEncoder(l.out).Encode(rec)
		return
	}

	tag := tagFor(level)
	if l.colors {
		fmt.Fprintf(l.out, "%s%s%s %s\n", colorFor(level), tag, ansiReset, msg)
	} else {
		fmt.Fprintf(l.out, "%s %s\n", tag, msg)
	}
}

func tagFor(level Level) string {
	switch level {
	case LevelInfo:
		return "[INFO]"
	case LevelOK:
		return "[OK]"
	case LevelWarn:
		return "[WARN]"
	case LevelError:
		return "[ERROR]"
	default:
		return "[?]"
	}
}

func colorFor(level Level) string {
	switch level {
	case LevelInfo:
		return ansiBlue
	case LevelOK:
		return ansiGreen
	case LevelWarn:
		return ansiYellow
	case LevelError:
		return ansiRed
	default:
		return ""
	}
}

// isTerminal is intentionally conservative: we do not pull in
// golang.org/x/term just to detect this, we check the presence of a
// common env var and the file mode. The worst case is we print ANSI to a
// non-TTY, which is ugly but harmless.
func isTerminal(w io.Writer) bool {
	f, ok := w.(*os.File)
	if !ok {
		return false
	}
	fi, err := f.Stat()
	if err != nil {
		return false
	}
	return (fi.Mode() & os.ModeCharDevice) != 0
}
