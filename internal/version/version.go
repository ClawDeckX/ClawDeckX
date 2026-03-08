package version

// Version is the application version. Injected at build time via ldflags:
//
//	go build -ldflags "-X ClawDeckX/internal/version.Version=0.0.3 -X ClawDeckX/internal/version.Build=42"
//
// Source of truth: web/package.json -> "version" field.
var Version = "0.0.7"

// Build is the build number, injected at compile time.
var Build = "dev"

// OpenClawCompat is the minimum compatible OpenClaw version.
// Source of truth: web/package.json -> "openclawCompat" field.
var OpenClawCompat = ">=2026.3.2"

