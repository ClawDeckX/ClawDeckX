//go:build windows

package handlers

import (
	"sync"
	"syscall"
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

var (
	cpuUsageMu     sync.Mutex
	cpuLastIdle    uint64
	cpuLastTotal   uint64
	cpuLastUsage   float64
	cpuSampledOnce bool
)

func collectCpuUsage() float64 {
	var idleTime, kernelTime, userTime fileTime
	ret, _, _ := procGetSystemTimes.Call(
		uintptr(unsafe.Pointer(&idleTime)),
		uintptr(unsafe.Pointer(&kernelTime)),
		uintptr(unsafe.Pointer(&userTime)),
	)
	if ret == 0 {
		cpuUsageMu.Lock()
		defer cpuUsageMu.Unlock()
		return cpuLastUsage
	}

	idle := fileTimeToUint64(idleTime)
	total := fileTimeToUint64(kernelTime) + fileTimeToUint64(userTime)

	cpuUsageMu.Lock()
	defer cpuUsageMu.Unlock()

	if !cpuSampledOnce {
		cpuLastIdle = idle
		cpuLastTotal = total
		cpuSampledOnce = true
		return cpuLastUsage
	}

	totalDelta := total - cpuLastTotal
	idleDelta := idle - cpuLastIdle
	cpuLastIdle = idle
	cpuLastTotal = total

	if totalDelta == 0 {
		return cpuLastUsage
	}

	usage := float64(totalDelta-idleDelta) / float64(totalDelta) * 100
	if usage < 0 {
		usage = 0
	} else if usage > 100 {
		usage = 100
	}
	cpuLastUsage = usage
	return cpuLastUsage
}
