//go:build darwin

package candidate

import (
	"fmt"
	"os"
	"syscall"
	"unsafe"
)

// renameat is syscall 465 on supported macOS releases. Go 1.24 exposes
// os.OpenRoot but not Root.Rename, so use the held directory descriptor.
const sysRenameat = 465

func renameWithinRoot(root *os.Root, oldName, newName string) error {
	dir, err := root.Open(".")
	if err != nil {
		return err
	}
	defer dir.Close()
	oldPointer, err := syscall.BytePtrFromString(oldName)
	if err != nil {
		return err
	}
	newPointer, err := syscall.BytePtrFromString(newName)
	if err != nil {
		return err
	}
	_, _, errno := syscall.Syscall6(
		sysRenameat,
		dir.Fd(),
		uintptr(unsafe.Pointer(oldPointer)),
		dir.Fd(),
		uintptr(unsafe.Pointer(newPointer)),
		0,
		0,
	)
	if errno != 0 {
		return fmt.Errorf("renameat: %w", errno)
	}
	return nil
}
