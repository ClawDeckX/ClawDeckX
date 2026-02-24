package openclaw

import "syscall"

// sysProcAttrDetached Windows 专用：CREATE_NO_WINDOW (0x08000000)
// 使子进程不创建也不继承任何控制台窗口，完全后台运行
var sysProcAttrDetached = syscall.SysProcAttr{
	CreationFlags: 0x08000000,
}
