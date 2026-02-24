package tray

import _ "embed"

//go:embed icon.ico
var iconData []byte

// generateIcon returns the embedded favicon.ico bytes.
func generateIcon() []byte {
	return iconData
}
