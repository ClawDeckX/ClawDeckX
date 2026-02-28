//go:build windows

package tray

import (
	"ClawDeckX/internal/i18n"
	"fmt"
	"os/exec"
	"runtime"
	"strings"

	"github.com/energye/systray"
)

// Run starts the system tray icon and opens the browser.
// onReady is called after the tray is initialized.
// This function blocks until the user quits via the tray menu.
func Run(addr string, onQuit func()) {
	browserAddr := strings.Replace(addr, "0.0.0.0", "localhost", 1)
	url := fmt.Sprintf("http://%s", browserAddr)

	systray.Run(func() {
		systray.SetIcon(generateIcon())
		systray.SetTitle("ClawDeckX")
		systray.SetTooltip(fmt.Sprintf("ClawDeckX - %s", url))

		// Click tray icon → open browser
		systray.SetOnClick(func(menu systray.IMenu) {
			openBrowser(url)
		})

		// Double click → open browser
		systray.SetOnDClick(func(menu systray.IMenu) {
			openBrowser(url)
		})

		// Right click → show menu
		systray.SetOnRClick(func(menu systray.IMenu) {
			menu.ShowMenu()
		})

		mOpen := systray.AddMenuItem(i18n.T(i18n.MsgTrayOpenWebUI), "Open Web UI")
		mOpen.Click(func() {
			openBrowser(url)
		})

		systray.AddSeparator()

		mAddr := systray.AddMenuItem(i18n.T(i18n.MsgTrayAddress, map[string]interface{}{"Url": url}), "")
		mAddr.Disable()

		systray.AddSeparator()

		mQuit := systray.AddMenuItem(i18n.T(i18n.MsgTrayQuit), "Quit")
		mQuit.Click(func() {
			if onQuit != nil {
				onQuit()
			}
			systray.Quit()
		})

		// Auto-open browser on first launch
		openBrowser(url)
	}, nil)
}

// HasGUI returns true on Windows/macOS.
func HasGUI() bool {
	return true
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	_ = cmd.Start()
}
