//go:build linux

package candidate

import (
	"os"
	"syscall"
)

func renameWithinRoot(root *os.Root, oldName, newName string) error {
	dir, err := root.Open(".")
	if err != nil {
		return err
	}
	defer dir.Close()
	return syscall.Renameat(int(dir.Fd()), oldName, int(dir.Fd()), newName)
}
