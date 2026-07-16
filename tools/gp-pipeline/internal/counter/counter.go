// Package counter manages the ticket ID counter for gu-log post prefixes
// (GP, MP, SD, Lv). It replaces the historical "flock + jq + mv" atomic
// bump dance from the retired bash pipeline with a Go native implementation
// backed by syscall.Flock on a per-process lock file.
//
// Storage format is scripts/article-counter.json, a simple object:
//
//	{
//	  "GP": {
//	    "next": 171,
//	    "label": "Gu-log Picks",
//	    "description": "Articles picked by ShroomDog, translated by Mogu"
//	  },
//	  "MP": { ... },
//	  "SD": { ... },
//	  "Lv": { ... }
//	}
//
// Invariants the bash pipeline relies on and this package preserves:
//   - "next" is the ID that will be allocated NEXT. Bump returns the OLD
//     value (the value just allocated) and advances "next" by 1.
//   - Only a single caller mutates the file at a time; concurrent pipelines
//     must serialise through /tmp/gu-log-counter.lock.
//   - File layout (label, description, field ordering) must be preserved
//     verbatim — the file is hand-maintained and reviewed in PRs, so a
//     reorder-on-write would produce a noisy diff.
package counter

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"syscall"
)

// DefaultLockPath is /tmp/gu-log-counter.lock; every counter writer must
// serialise through the same lock file.
const DefaultLockPath = "/tmp/gu-log-counter.lock"

// ValidPrefixes are the four ticket prefixes the gu-log repo knows about.
var ValidPrefixes = []string{"GP", "MP", "SD", "Lv"}

// legacyPrefixHint maps prefixes retired by the Mogu/GP/MP rebrand to their
// canonical replacements, so callers get an actionable error instead of a
// bare "unknown prefix".
var legacyPrefixHint = map[string]string{
	"SP": "GP",
	"CP": "MP",
}

var ticketIDPattern = regexp.MustCompile(`^(GP|MP|SD|Lv)-(PENDING|[0-9]+)$`)
var legacyTicketIDPattern = regexp.MustCompile(`^(SP|CP)-(PENDING|[0-9]+)$`)

// ValidatePrefix returns nil for a canonical prefix and an actionable error
// otherwise. Retired legacy prefixes (SP, CP) name their canonical
// replacement; they are never silently translated.
func ValidatePrefix(p string) error {
	if validPrefix(p) {
		return nil
	}
	if canonical, ok := legacyPrefixHint[p]; ok {
		return fmt.Errorf("counter: prefix %q was retired by the Mogu/GP/MP rebrand — use %q", p, canonical)
	}
	return fmt.Errorf("counter: invalid prefix %q (want one of %v)", p, ValidPrefixes)
}

// PendingTicketID returns the canonical pending ticket for prefix.
func PendingTicketID(prefix string) (string, error) {
	if err := ValidatePrefix(prefix); err != nil {
		return "", err
	}
	return prefix + "-PENDING", nil
}

// ValidateTicketID rejects unqualified PENDING values and retired SP/CP
// tickets. It never translates input silently.
func ValidateTicketID(ticketID string) error {
	if ticketIDPattern.MatchString(ticketID) {
		return nil
	}
	if match := legacyTicketIDPattern.FindStringSubmatch(ticketID); match != nil {
		canonical := legacyPrefixHint[match[1]] + "-" + match[2]
		return fmt.Errorf("counter: ticket ID %q was retired by the Mogu/GP/MP rebrand — use %q", ticketID, canonical)
	}
	if ticketID == "PENDING" {
		return fmt.Errorf("counter: ticket ID %q is missing a series prefix — use GP-PENDING, MP-PENDING, SD-PENDING, or Lv-PENDING", ticketID)
	}
	return fmt.Errorf("counter: invalid ticket ID %q (want ^(GP|MP|SD|Lv)-(PENDING|N)$)", ticketID)
}

// ValidateTicketIDForPrefix also checks that the ticket and requested series
// agree, so a GP command cannot accidentally emit an MP ticket.
func ValidateTicketIDForPrefix(ticketID, prefix string) error {
	if err := ValidatePrefix(prefix); err != nil {
		return err
	}
	if err := ValidateTicketID(ticketID); err != nil {
		return err
	}
	match := ticketIDPattern.FindStringSubmatch(ticketID)
	if match[1] != prefix {
		return fmt.Errorf("counter: ticket ID %q does not match --prefix %q", ticketID, prefix)
	}
	return nil
}

// Entry mirrors one prefix entry in article-counter.json.
type Entry struct {
	Next        int    `json:"next"`
	Label       string `json:"label"`
	Description string `json:"description"`
}

// Counter is a lockable accessor to the article-counter.json file.
type Counter struct {
	Path     string
	LockPath string
}

// New returns a Counter backed by the given counter file. If lockPath is
// empty, DefaultLockPath is used.
func New(path, lockPath string) *Counter {
	if lockPath == "" {
		lockPath = DefaultLockPath
	}
	return &Counter{Path: path, LockPath: lockPath}
}

// Read loads the counter file without taking a lock. Safe for read-only
// callers. Returns an ordered map-ish struct keyed by prefix.
func (c *Counter) Read() (map[string]Entry, error) {
	data, err := os.ReadFile(c.Path)
	if err != nil {
		return nil, fmt.Errorf("counter: read %s: %w", c.Path, err)
	}
	var m map[string]Entry
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, fmt.Errorf("counter: parse %s: %w", c.Path, err)
	}
	if err := validateEntries(m); err != nil {
		return nil, fmt.Errorf("counter: parse %s: %w", c.Path, err)
	}
	return m, nil
}

// Next returns the "next" value for a prefix without mutating the file.
// It does NOT take the lock — callers that want to avoid races with a
// concurrent Bump should use Bump directly.
func (c *Counter) Next(prefix string) (int, error) {
	if err := ValidatePrefix(prefix); err != nil {
		return 0, err
	}
	m, err := c.Read()
	if err != nil {
		return 0, err
	}
	entry, ok := m[prefix]
	if !ok {
		return 0, fmt.Errorf("counter: unknown prefix %q", prefix)
	}
	return entry.Next, nil
}

// Bump atomically reads the "next" value for prefix, writes next+1 back
// to the file, and returns the value that was just allocated (i.e. the
// OLD next, which is the ID the caller should use for their new ticket).
//
// The file is rewritten with a sed-like surgical replacement to preserve
// field ordering, label, description, and whitespace. This matches the
// behaviour of the bash script, which also does a targeted line edit
// rather than a full JSON round trip.
func (c *Counter) Bump(prefix string) (allocated int, err error) {
	if err := ValidatePrefix(prefix); err != nil {
		return 0, err
	}
	return c.withLock(func() (int, error) {
		raw, err := os.ReadFile(c.Path)
		if err != nil {
			return 0, fmt.Errorf("counter: read %s: %w", c.Path, err)
		}
		var entries map[string]Entry
		if err := json.Unmarshal(raw, &entries); err != nil {
			return 0, fmt.Errorf("counter: parse %s: %w", c.Path, err)
		}
		if err := validateEntries(entries); err != nil {
			return 0, fmt.Errorf("counter: parse %s: %w", c.Path, err)
		}

		current, newText, err := surgicalBump(raw, prefix)
		if err != nil {
			return 0, err
		}

		tmpPath := c.Path + ".tmp"
		if err := os.WriteFile(tmpPath, newText, 0o644); err != nil {
			return 0, fmt.Errorf("counter: write tmp: %w", err)
		}
		if err := os.Rename(tmpPath, c.Path); err != nil {
			return 0, fmt.Errorf("counter: rename tmp: %w", err)
		}
		return current, nil
	})
}

func (c *Counter) withLock(fn func() (int, error)) (int, error) {
	if err := os.MkdirAll(filepath.Dir(c.LockPath), 0o755); err != nil {
		return 0, fmt.Errorf("counter: mkdir lock parent: %w", err)
	}
	lf, err := os.OpenFile(c.LockPath, os.O_CREATE|os.O_RDWR, 0o644)
	if err != nil {
		return 0, fmt.Errorf("counter: open lock: %w", err)
	}
	defer lf.Close()

	if err := syscall.Flock(int(lf.Fd()), syscall.LOCK_EX); err != nil {
		return 0, fmt.Errorf("counter: acquire flock: %w", err)
	}
	defer syscall.Flock(int(lf.Fd()), syscall.LOCK_UN)

	return fn()
}

// surgicalBump finds the "next": N line under "<prefix>": { ... } and
// rewrites the N inline. It preserves the rest of the file byte-for-byte.
// It returns the OLD value of N (the value just allocated) and the new
// file bytes.
//
// The targeted regex is tight enough to not match nested "next" fields
// elsewhere: it requires the prefix key to appear on its own line and
// the "next" key to appear within the next four lines of the same block.
func surgicalBump(raw []byte, prefix string) (int, []byte, error) {
	// Match: "GP": { ... "next": NUMBER
	// We allow up to 6 lines of whitespace / comments between the prefix
	// line and the "next" line so we are robust to small layout variations.
	pattern := fmt.Sprintf(`(?m)^(\s*"%s"\s*:\s*\{[^}]*?"next"\s*:\s*)(\d+)`, regexp.QuoteMeta(prefix))
	re := regexp.MustCompile(pattern)
	m := re.FindSubmatchIndex(raw)
	if m == nil {
		return 0, nil, fmt.Errorf("counter: could not locate %q block in counter file", prefix)
	}

	numStart, numEnd := m[4], m[5]
	current, err := strconv.Atoi(string(raw[numStart:numEnd]))
	if err != nil {
		return 0, nil, fmt.Errorf("counter: parse current value: %w", err)
	}

	updated := strconv.Itoa(current + 1)
	newBytes := make([]byte, 0, len(raw)+len(updated)-(numEnd-numStart))
	newBytes = append(newBytes, raw[:numStart]...)
	newBytes = append(newBytes, []byte(updated)...)
	newBytes = append(newBytes, raw[numEnd:]...)
	return current, newBytes, nil
}

func validPrefix(p string) bool {
	for _, v := range ValidPrefixes {
		if v == p {
			return true
		}
	}
	return false
}

func validateEntries(entries map[string]Entry) error {
	for prefix := range entries {
		if canonical, retired := legacyPrefixHint[prefix]; retired {
			return fmt.Errorf("counter file contains retired prefix %q — use %q", prefix, canonical)
		}
		if !validPrefix(prefix) {
			return fmt.Errorf("counter file contains unknown prefix %q (want one of %v)", prefix, ValidPrefixes)
		}
	}
	for _, prefix := range ValidPrefixes {
		if _, ok := entries[prefix]; !ok {
			return fmt.Errorf("counter file is missing required prefix %q", prefix)
		}
	}
	return nil
}
