package llm

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

// FakeProvider is a test double that returns canned responses and records
// every prompt it was asked to satisfy. It exists because CCC (Cloud Claude
// Code) cannot authenticate `claude -p` non-interactively, so the LLM-heavy
// subcommands have to be exercised against a controllable replacement.
//
// Each FakeResponse is popped in order from the queue. When the queue is
// empty, further calls return ErrQueueEmpty. The optional WriteFile field
// lets the fake mimic real prompts that instruct the LLM to "write your
// answer to foo.json in the current directory" — the fake creates the file
// with Output as its contents, honoring the caller's RunOptions.WorkDir.
type FakeProvider struct {
	NameStr    string
	ModelID    ModelID
	AvailableV bool

	mu        sync.Mutex
	Responses []FakeResponse
	Called    []FakeCall
}

// FakeResponse is a single queued reply.
type FakeResponse struct {
	// Output is the string the fake returns from Run, and (if WriteFile is
	// set) the contents of the file it creates before returning.
	Output string `json:"output"`
	// Err, when set, makes the Run call fail with this error message.
	Err string `json:"err,omitempty"`
	// WriteFile is a relative or absolute path. If relative, it is resolved
	// against RunOptions.WorkDir (or the process CWD when WorkDir is empty).
	// A non-empty value triggers a file write before Run returns.
	WriteFile string `json:"writeFile,omitempty"`
}

// FakeCall records a single invocation so tests can assert on prompts.
type FakeCall struct {
	Prompt string
	Opts   RunOptions
}

// ErrQueueEmpty is returned when FakeProvider.Run is called but no queued
// responses remain.
var ErrQueueEmpty = errors.New("fake provider: response queue empty")

// NewFakeClaude returns a FakeProvider that claims to be claude-opus.
// This is the common case for unit tests.
func NewFakeClaude() *FakeProvider {
	return &FakeProvider{
		NameStr:    "fake-claude-opus",
		ModelID:    ModelClaudeOpus,
		AvailableV: true,
	}
}

// WithResponses seeds the response queue. Returns the receiver so it chains.
func (f *FakeProvider) WithResponses(r ...FakeResponse) *FakeProvider {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.Responses = append(f.Responses, r...)
	return f
}

// Name implements Provider.
func (f *FakeProvider) Name() string { return f.NameStr }

// Model implements Provider.
func (f *FakeProvider) Model() ModelID { return f.ModelID }

// Available implements Provider.
func (f *FakeProvider) Available() bool { return f.AvailableV }

// Run implements Provider: pop the next queued response, optionally write
// the side-effect file, and return the canned output.
func (f *FakeProvider) Run(ctx context.Context, prompt string, opts RunOptions) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	f.Called = append(f.Called, FakeCall{Prompt: prompt, Opts: opts})

	if len(f.Responses) == 0 {
		return "", ErrQueueEmpty
	}
	next := f.Responses[0]
	f.Responses = f.Responses[1:]

	if next.WriteFile != "" {
		path := next.WriteFile
		if !filepath.IsAbs(path) && opts.WorkDir != "" {
			path = filepath.Join(opts.WorkDir, path)
		}
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return "", fmt.Errorf("fake provider: mkdir %s: %w", path, err)
		}
		if err := os.WriteFile(path, []byte(next.Output), 0o644); err != nil {
			return "", fmt.Errorf("fake provider: write %s: %w", path, err)
		}
	}

	if next.Err != "" {
		return next.Output, errors.New(next.Err)
	}
	return next.Output, nil
}

// Reset clears Called and any unread responses. Tests that reuse a single
// FakeProvider across cases call this in t.Cleanup.
func (f *FakeProvider) Reset() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.Called = nil
	f.Responses = nil
}

// FakeSpec is the on-disk shape of a --fake-provider JSON file. Tests and
// the CLI's hidden --fake-provider flag load a FakeSpec and feed the
// responses into a FakeProvider.
type FakeSpec struct {
	Provider  string         `json:"provider,omitempty"` // defaults to "fake-claude-opus"
	Model     ModelID        `json:"model,omitempty"`    // defaults to ModelClaudeOpus
	Responses []FakeResponse `json:"responses"`
}

// LoadFakeFromJSON reads a FakeSpec from path and constructs a FakeProvider.
func LoadFakeFromJSON(path string) (*FakeProvider, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("load fake spec %s: %w", path, err)
	}
	var spec FakeSpec
	if err := json.Unmarshal(data, &spec); err != nil {
		return nil, fmt.Errorf("parse fake spec %s: %w", path, err)
	}
	fp := NewFakeClaude()
	if spec.Provider != "" {
		fp.NameStr = spec.Provider
	}
	if spec.Model != "" {
		fp.ModelID = spec.Model
	}
	fp.Responses = spec.Responses
	return fp, nil
}
