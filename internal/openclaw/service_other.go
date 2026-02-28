//go:build !windows

package openclaw

import "syscall"

var sysProcAttrDetached = syscall.SysProcAttr{}
