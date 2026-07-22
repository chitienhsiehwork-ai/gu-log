package counter

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

// fixtureCounter is a minimised article-counter.json that exercises the
// layout with all four prefixes and preserves the descriptions so the
// surgical-bump regex has to navigate around them.
const fixtureCounter = `{
  "SD": {
    "next": 20,
    "label": "ShroomDog Original",
    "description": "Original articles written by ShroomDog"
  },
  "GP": {
    "next": 171,
    "label": "Gu-log Picks",
    "description": "Articles picked by ShroomDog, translated by Mogu"
  },
  "MP": {
    "next": 278,
    "label": "Mogu Picks",
    "description": "Articles autonomously picked and translated by Mogu"
  },
  "Lv": {
    "next": 12,
    "label": "Level-Up",
    "description": "Level-Up tutorial series — beginner-friendly deep dives"
  }
}
`

func writeFixture(t *testing.T) (path string, lockPath string) {
	t.Helper()
	dir := t.TempDir()
	path = filepath.Join(dir, "article-counter.json")
	lockPath = filepath.Join(dir, "counter.lock")
	if err := os.WriteFile(path, []byte(fixtureCounter), 0o644); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	return path, lockPath
}

func TestNext_Read(t *testing.T) {
	path, lockPath := writeFixture(t)
	c := New(path, lockPath)

	cases := map[string]int{
		"SD": 20,
		"GP": 171,
		"MP": 278,
		"Lv": 12,
	}
	for prefix, want := range cases {
		got, err := c.Next(prefix)
		if err != nil {
			t.Errorf("Next(%q): %v", prefix, err)
			continue
		}
		if got != want {
			t.Errorf("Next(%q) = %d, want %d", prefix, got, want)
		}
	}
}

func TestBump_ReturnsOldAndAdvances(t *testing.T) {
	path, lockPath := writeFixture(t)
	c := New(path, lockPath)

	allocated, err := c.Bump("GP")
	if err != nil {
		t.Fatalf("Bump: %v", err)
	}
	if allocated != 171 {
		t.Errorf("Bump returned %d, want 171 (the value just allocated)", allocated)
	}
	next, err := c.Next("GP")
	if err != nil {
		t.Fatalf("Next after bump: %v", err)
	}
	if next != 172 {
		t.Errorf("next after bump = %d, want 172", next)
	}

	// Other prefixes must not have moved.
	for _, p := range []string{"SD", "MP", "Lv"} {
		nxt, err := c.Next(p)
		if err != nil {
			t.Errorf("%s: %v", p, err)
			continue
		}
		want := map[string]int{"SD": 20, "MP": 278, "Lv": 12}[p]
		if nxt != want {
			t.Errorf("%s next = %d, want %d (bumping GP must not touch other prefixes)", p, nxt, want)
		}
	}
}

func TestBump_PreservesFileShape(t *testing.T) {
	path, lockPath := writeFixture(t)
	c := New(path, lockPath)

	if _, err := c.Bump("MP"); err != nil {
		t.Fatalf("Bump: %v", err)
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	text := string(after)
	// Labels and descriptions must be preserved verbatim.
	for _, want := range []string{
		"\"ShroomDog Original\"",
		"\"Gu-log Picks\"",
		"\"Mogu Picks\"",
		"\"Level-Up\"",
		"\"Articles autonomously picked and translated by Mogu\"",
	} {
		if !strings.Contains(text, want) {
			t.Errorf("file missing %s after bump — layout corrupted", want)
		}
	}
	// MP.next must be 279.
	if !strings.Contains(text, `"next": 279`) {
		t.Errorf("file should contain MP next=279 after bump, got:\n%s", text)
	}
}

func TestBump_InvalidPrefix(t *testing.T) {
	path, lockPath := writeFixture(t)
	c := New(path, lockPath)

	if _, err := c.Bump("NOPE"); err == nil {
		t.Errorf("expected error for invalid prefix")
	}
}

func TestRetiredPrefixesFailWithCanonicalHint(t *testing.T) {
	path, lockPath := writeFixture(t)
	c := New(path, lockPath)

	for legacy, canonical := range map[string]string{"SP": "GP", "CP": "MP"} {
		_, err := c.Next(legacy)
		if err == nil || !strings.Contains(err.Error(), `use "`+canonical+`"`) {
			t.Errorf("Next(%q) error = %v, want canonical hint %q", legacy, err, canonical)
		}
	}
}

func TestTicketIDValidation(t *testing.T) {
	for _, ticketID := range []string{"GP-PENDING", "MP-315", "SD-1", "Lv-PENDING"} {
		if err := ValidateTicketID(ticketID); err != nil {
			t.Errorf("ValidateTicketID(%q): %v", ticketID, err)
		}
	}
	for legacy, hint := range map[string]string{
		"SP-PENDING": "GP-PENDING",
		"CP-314":     "MP-314",
		"PENDING":    "GP-PENDING",
	} {
		err := ValidateTicketID(legacy)
		if err == nil || !strings.Contains(err.Error(), hint) {
			t.Errorf("ValidateTicketID(%q) error = %v, want hint %q", legacy, err, hint)
		}
	}
	if err := ValidateTicketIDForPrefix("MP-PENDING", "GP"); err == nil {
		t.Error("expected mismatched ticket/prefix to fail")
	}
}

func TestReadRejectsRetiredAndUnknownCounterKeys(t *testing.T) {
	for name, replacement := range map[string]string{
		"retired": strings.Replace(fixtureCounter, `"GP"`, `"SP"`, 1),
		"unknown": strings.Replace(fixtureCounter, `"GP"`, `"XX"`, 1),
	} {
		t.Run(name, func(t *testing.T) {
			dir := t.TempDir()
			path := filepath.Join(dir, "article-counter.json")
			if err := os.WriteFile(path, []byte(replacement), 0o644); err != nil {
				t.Fatal(err)
			}
			if _, err := New(path, filepath.Join(dir, "lock")).Read(); err == nil {
				t.Fatal("expected invalid counter schema to fail")
			}
		})
	}
}

func TestBump_Concurrent(t *testing.T) {
	// Fire 20 concurrent Bump(GP) calls and verify we get 20 DISTINCT
	// allocated values with no gaps — the flock must serialise them.
	path, lockPath := writeFixture(t)
	c := New(path, lockPath)

	const N = 20
	results := make([]int, N)
	var wg sync.WaitGroup
	wg.Add(N)
	for i := 0; i < N; i++ {
		i := i
		go func() {
			defer wg.Done()
			v, err := c.Bump("GP")
			if err != nil {
				t.Errorf("goroutine %d: %v", i, err)
				return
			}
			results[i] = v
		}()
	}
	wg.Wait()

	seen := map[int]bool{}
	minV, maxV := 1<<30, 0
	for _, v := range results {
		if seen[v] {
			t.Errorf("duplicate allocation: %d seen twice", v)
		}
		seen[v] = true
		if v < minV {
			minV = v
		}
		if v > maxV {
			maxV = v
		}
	}
	if minV != 171 {
		t.Errorf("min allocated = %d, want 171", minV)
	}
	if maxV != 171+N-1 {
		t.Errorf("max allocated = %d, want %d", maxV, 171+N-1)
	}
	if len(seen) != N {
		t.Errorf("saw %d distinct values, want %d", len(seen), N)
	}
}

func TestBump_MissingFile(t *testing.T) {
	dir := t.TempDir()
	c := New(filepath.Join(dir, "missing.json"), filepath.Join(dir, "lock"))
	if _, err := c.Bump("GP"); err == nil {
		t.Errorf("expected error for missing file")
	}
}
