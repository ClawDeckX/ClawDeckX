//go:build !windows

package openclaw

import "syscall"

// sysProcAttrDetached Unix 平台无需特殊标志（nohup 方式启动）
var sysProcAttrDetached = syscall.SysProcAttr{}
