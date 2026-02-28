package openclaw

import "syscall"

var sysProcAttrDetached = syscall.SysProcAttr{
	CreationFlags: 0x08000000,
}
