//go:build windows

package handlers

import (
	"os"
	"syscall"
	"unsafe"
)

func collectDiskUsage(home string) []DiskInfo {
	var disks []DiskInfo
	drives := []string{"C:\\"}
	if home != "" && len(home) >= 3 {
		drv := home[:3]
		found := false
		for _, d := range drives {
			if d == drv {
				found = true
				break
			}
		}
		if !found {
			drives = append(drives, drv)
		}
	}
	for _, d := range drives {
		if info, err := getDiskFreeSpace(d); err == nil {
			disks = append(disks, info)
		}
	}
	return disks
}

func getDiskFreeSpace(path string) (DiskInfo, error) {
	if _, err := os.Stat(path); err != nil {
		return DiskInfo{}, err
	}

	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	proc := kernel32.NewProc("GetDiskFreeSpaceExW")

	var freeBytesAvailable, totalBytes, totalFreeBytes uint64
	pathPtr, _ := syscall.UTF16PtrFromString(path)

	ret, _, err := proc.Call(
		uintptr(unsafe.Pointer(pathPtr)),
		uintptr(unsafe.Pointer(&freeBytesAvailable)),
		uintptr(unsafe.Pointer(&totalBytes)),
		uintptr(unsafe.Pointer(&totalFreeBytes)),
	)
	if ret == 0 {
		return DiskInfo{Path: path}, err
	}

	used := totalBytes - totalFreeBytes
	pct := float64(0)
	if totalBytes > 0 {
		pct = float64(used) / float64(totalBytes) * 100
	}
	return DiskInfo{
		Path:    path,
		Total:   totalBytes,
		Free:    totalFreeBytes,
		Used:    used,
		UsedPct: pct,
	}, nil
}
