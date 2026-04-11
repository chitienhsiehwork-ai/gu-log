package pipeline

import "os/exec"

// execCommand is a tiny indirection so phase3_test.go can call exec without
// importing os/exec directly and without creating test-package-only symbols.
var execCommand = exec.Command
