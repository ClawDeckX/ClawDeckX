//go:build !windows

package handlers

import (
	"os"
	"strconv"
	"strings"
	"time"
)

func collectOsUptime() int64 {
	data, err := os.ReadFile("/proc/uptime")
	if err != nil {
		return 0
	}
	fields := strings.Fields(string(data))
	if len(fields) < 1 {
		return 0
	}
	secs, err := strconv.ParseFloat(fields[0], 64)
	if err != nil {
		return 0
	}
	return int64(secs * 1000)
}

func collectSysMemory() SysMemInfo {
	// Linux: read /proc/meminfo
	data, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return SysMemInfo{}
	}

	var total, free, available, buffers, cached uint64
	for _, line := range strings.Split(string(data), "\n") {
		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}
		val, _ := strconv.ParseUint(parts[1], 10, 64)
		val *= 1024 // kB to bytes
		switch parts[0] {
		case "MemTotal:":
			total = val
		case "MemFree:":
			free = val
		case "MemAvailable:":
			available = val
		case "Buffers:":
			buffers = val
		case "Cached:":
			cached = val
		}
	}

	// Prefer MemAvailable if present (Linux 3.14+)
	actualFree := available
	if actualFree == 0 {
		actualFree = free + buffers + cached
	}
	used := uint64(0)
	if total > actualFree {
		used = total - actualFree
	}
	pct := float64(0)
	if total > 0 {
		pct = float64(used) / float64(total) * 100
	}
	return SysMemInfo{
		Total:   total,
		Used:    used,
		Free:    actualFree,
		UsedPct: pct,
	}
}

func collectCpuUsage() float64 {
	// Linux: read /proc/stat twice with a short interval
	read := func() (idle, total uint64, ok bool) {
		data, err := os.ReadFile("/proc/stat")
		if err != nil {
			return 0, 0, false
		}
		lines := strings.Split(string(data), "\n")
		if len(lines) == 0 {
			return 0, 0, false
		}
		fields := strings.Fields(lines[0]) // "cpu user nice system idle iowait irq softirq ..."
		if len(fields) < 5 || fields[0] != "cpu" {
			return 0, 0, false
		}
		var sum uint64
		for i := 1; i < len(fields); i++ {
			v, _ := strconv.ParseUint(fields[i], 10, 64)
			sum += v
			if i == 4 { // idle is the 4th value (index 4 in fields, 1-indexed field 4)
				idle = v
			}
		}
		return idle, sum, true
	}

	idle1, total1, ok1 := read()
	if !ok1 {
		return 0
	}
	time.Sleep(200 * time.Millisecond)
	idle2, total2, ok2 := read()
	if !ok2 {
		return 0
	}

	totalDelta := total2 - total1
	idleDelta := idle2 - idle1
	if totalDelta == 0 {
		return 0
	}
	return float64(totalDelta-idleDelta) / float64(totalDelta) * 100
}
