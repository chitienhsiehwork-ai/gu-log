//go:build !darwin && !linux

package candidate

import (
	"fmt"
	"os"
	"runtime"
)

func renameWithinRoot(_ *os.Root, _, _ string) error {
	return fmt.Errorf("directory-handle-bound rename is unsupported on %s", runtime.GOOS)
}
