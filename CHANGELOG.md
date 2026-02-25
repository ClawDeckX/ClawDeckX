# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Development workflow documentation (CONTRIBUTING.md)
- Changelog file for tracking version history

## [v0.0.1] - 2026-02-25

### Added
- Intelligent network optimization for international and China users
- Backend `netutil` package with smart mirror selection
- GitHub API mirrors (official + ghproxy)
- GitHub Release download mirrors for faster updates
- npm Registry mirrors (official + npmmirror + Tencent)
- Frontend `network.ts` service with mirror detection
- `SmartLink` component for automatic GitHub URL optimization
- Automatic npm registry detection in SetupWizard
- Ko-fi button with inline SVG (no external dependencies)
- Intelligent font loading with CDN fallback

### Changed
- Mirror cache duration extended to 24 hours (from 10 minutes)
- Updated `updater.go` to use smart mirror selection
- Settings page now uses SmartLink for all GitHub links

### Technical Details
- Parallel mirror testing with 3-second timeout
- Location detection based on timezone and browser language
- 24-hour cache to minimize network overhead
- Graceful fallback to official sources on failure

---

## Version History

- **v0.0.1** (2026-02-25): Initial network optimization release
