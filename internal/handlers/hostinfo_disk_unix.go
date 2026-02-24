//go:build !windows

package handlers

import (
	"syscall"
)

func collectDiskUsage(home string) []DiskInfo {
	var disks []DiskInfo
	paths := []string{"/"}
	if home != "" && home != "/" {
		paths = append(paths, home)
	}
	for _, p := range paths {
		var stat syscall.Statfs_t
		if err := syscall.Statfs(p, &stat); err != nil {
			continue
		}
		total := stat.Blocks * uint64(stat.Bsize)
		free := stat.Bavail * uint64(stat.Bsize)
		used := total - free
		pct := float64(0)
		if total > 0 {
			pct = float64(used) / float64(total) * 100
		}
		disks = append(disks, DiskInfo{
			Path:    p,
			Total:   total,
			Free:    free,
			Used:    used,
			UsedPct: pct,
		})
	}
	return disks
}
