//go:build windows

package commands

import "os"

func lookupOwnerPlatform(info os.FileInfo) string {
	return "未知"
}
