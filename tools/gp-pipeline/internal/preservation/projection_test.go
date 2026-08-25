package preservation

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestProjectFileVerifiesNodeEnvelopeWithoutNormalizingEmoji(t *testing.T) {
	repoRoot, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "post.mdx")
	if err := os.WriteFile(path, []byte("---\ntitle: T\n---\n\n已核准的正文 ✨\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	projection, err := ProjectFile(context.Background(), repoRoot, path)
	if err != nil {
		t.Fatal(err)
	}
	if projection.Body != "\n已核准的正文 ✨\n" || projection.SHA256 != SHA256([]byte(projection.Body)) {
		t.Fatalf("projection = %#v", projection)
	}
}
