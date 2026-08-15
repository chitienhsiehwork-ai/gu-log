package terminology

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadCanonicalContextIncludesOnlyCanonicalTermAndForbiddenZhTw(t *testing.T) {
	root := t.TempDir()
	dataDir := filepath.Join(root, "src", "data")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatal(err)
	}
	data := `[
  {"term":"Ignored","definition":"no forbidden terms"},
  {"term":"Agent","definition":"must not leak","forbiddenZhTw":["代理人"]},
  {"term":"Proxy","forbiddenZhTw":[]}
]`
	if err := os.WriteFile(filepath.Join(dataDir, "glossary.json"), []byte(data), 0o644); err != nil {
		t.Fatal(err)
	}

	context, err := LoadCanonicalContext(root)
	if err != nil {
		t.Fatal(err)
	}
	if context != `[{"term":"Agent","forbiddenZhTw":["代理人"]}]` {
		t.Fatalf("unexpected terminology context: %s", context)
	}
}
