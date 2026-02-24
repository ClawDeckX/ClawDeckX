//go:build windows

package handlers

import (
	"syscall"
	"time"
	"unsafe"
)

var (
	kernel32                 = syscall.NewLazyDLL("kernel32.dll")
	procGlobalMemoryStatusEx = kernel32.NewProc("GlobalMemoryStatusEx")
	procGetSystemTimes       = kernel32.NewProc("GetSystemTimes")
	procGetTickCount64       = kernel32.NewProc("GetTickCount64")
)

func collectOsUptime() int64 {
	ret, _, _ := procGetTickCount64.Call()
	if ret == 0 {
		return 0
	}
	return int64(ret)
}

type memoryStatusEx struct {
	Length               uint32
	MemoryLoad           uint32
	TotalPhys            uint64
	AvailPhys            uint64
	TotalPageFile        uint64
	AvailPageFile        uint64
	TotalVirtual         uint64
	AvailVirtual         uint64
	AvailExtendedVirtual uint64
}

func collectSysMemory() SysMemInfo {
	var ms memoryStatusEx
	ms.Length = uint32(unsafe.Sizeof(ms))
	ret, _, _ := procGlobalMemoryStatusEx.Call(uintptr(unsafe.Pointer(&ms)))
	if ret == 0 {
		return SysMemInfo{}
	}
	used := ms.TotalPhys - ms.AvailPhys
	pct := float64(0)
	if ms.TotalPhys > 0 {
		pct = float64(used) / float64(ms.TotalPhys) * 100
	}
	return SysMemInfo{
		Total:   ms.TotalPhys,
		Used:    used,
		Free:    ms.AvailPhys,
		UsedPct: pct,
	}
}

type fileTime struct {
	LowDateTime  uint32
	HighDateTime uint32
}

func fileTimeToUint64(ft fileTime) uint64 {
	return uint64(ft.HighDateTime)<<32 | uint64(ft.LowDateTime)
}

func collectCpuUsage() float64 {
	var idleTime1, kernelTime1, userTime1 fileTime
	ret, _, _ := procGetSystemTimes.Call(
		uintptr(unsafe.Pointer(&idleTime1)),
		uintptr(unsafe.Pointer(&kernelTime1)),
		uintptr(unsafe.Pointer(&userTime1)),
	)
	if ret == 0 {
		return 0
	}

	time.Sleep(200 * time.Millisecond)

	var idleTime2, kernelTime2, userTime2 fileTime
	ret, _, _ = procGetSystemTimes.Call(
		uintptr(unsafe.Pointer(&idleTime2)),
		uintptr(unsafe.Pointer(&kernelTime2)),
		uintptr(unsafe.Pointer(&userTime2)),
	)
	if ret == 0 {
		return 0
	}

	idle := fileTimeToUint64(idleTime2) - fileTimeToUint64(idleTime1)
	kernel := fileTimeToUint64(kernelTime2) - fileTimeToUint64(kernelTime1)
	user := fileTimeToUint64(userTime2) - fileTimeToUint64(userTime1)

	total := kernel + user
	if total == 0 {
		return 0
	}
	return float64(total-idle) / float64(total) * 100
}
