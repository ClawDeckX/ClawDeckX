//go:build !windows

package handlers

import (
	"os"
	"strconv"
	"strings"
	"sync"
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
	// Linux: non-blocking incremental sample based on previous /proc/stat snapshot.
	data, err := os.ReadFile("/proc/stat")
	if err != nil {
		cpuUsageMu.Lock()
		defer cpuUsageMu.Unlock()
		return cpuLastUsage
	}
	lines := strings.Split(string(data), "\n")
	if len(lines) == 0 {
		cpuUsageMu.Lock()
		defer cpuUsageMu.Unlock()
		return cpuLastUsage
	}
	fields := strings.Fields(lines[0]) // "cpu user nice system idle iowait irq softirq ..."
	if len(fields) < 5 || fields[0] != "cpu" {
		cpuUsageMu.Lock()
		defer cpuUsageMu.Unlock()
		return cpuLastUsage
	}

	var idle, total uint64
	for i := 1; i < len(fields); i++ {
		v, _ := strconv.ParseUint(fields[i], 10, 64)
		total += v
		if i == 4 { // idle is the 4th value (index 4 in fields, 1-indexed field 4)
			idle = v
		}
	}

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

var (
	cpuUsageMu     sync.Mutex
	cpuLastIdle    uint64
	cpuLastTotal   uint64
	cpuLastUsage   float64
	cpuSampledOnce bool
)
