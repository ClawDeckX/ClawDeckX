//go:build !windows

package handlers

import (
	"os"
	"syscall"
)

func terminateContainerInit() bool {
	if os.Getpid() == 1 {
		return false
	}
	return syscall.Kill(1, syscall.SIGTERM) == nil
}
