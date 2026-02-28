//go:build windows

package commands

import (
	"ClawDeckX/internal/i18n"
	"os"
)

func lookupOwnerPlatform(info os.FileInfo) string {
	return i18n.T(i18n.MsgOwnerUnknown)
}
