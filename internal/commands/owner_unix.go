//go:build !windows

package commands

import (
	"fmt"
	"os"
	"os/user"
	"strconv"
	"syscall"
)

func lookupOwnerPlatform(info os.FileInfo) string {
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return "未知"
	}
	uid := strconv.FormatUint(uint64(stat.Uid), 10)
	userInfo, err := user.LookupId(uid)
	if err != nil || userInfo == nil || userInfo.Username == "" {
		return fmt.Sprintf("UID %s", uid)
	}
	return userInfo.Username
}
