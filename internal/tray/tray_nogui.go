//go:build !windows

package tray

// Run is a no-op on Linux/headless systems.
// The server runs in the foreground terminal.
func Run(addr string, onQuit func()) {
	// No tray on Linux — server runs in foreground, Ctrl+C to quit
}

// HasGUI returns false on Linux/headless.
func HasGUI() bool {
	return false
}
