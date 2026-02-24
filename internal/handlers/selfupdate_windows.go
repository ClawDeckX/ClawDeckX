//go:build windows

package handlers

import "errors"

// execSyscall is not used on Windows; restart is handled via exec.Command.
func execSyscall(exe string, args []string, env []string) error {
	return errors.New("exec not supported on windows")
}
