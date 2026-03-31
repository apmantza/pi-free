# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Structured logging with namespaced logger (lib/logger.ts)
- LICENSE file (MIT)
- CHANGELOG.md

### Changed
- **Major refactoring**: Split free-tier-limits.ts into usage/* modules
  - usage/tracking.ts - runtime session tracking
  - usage/cumulative.ts - persistent storage
  - usage/formatters.ts - display formatting
  - 77% line reduction (741 → 166 lines)
- **Major refactoring**: Split usage-widget.ts into widget/* modules
  - widget/data.ts - data collection
  - widget/format.ts - formatting utilities
  - widget/render.ts - HTML generation
  - 74% line reduction (~350 → 90 lines)
- **Refactoring**: Extracted functions from cline-auth.ts
  - fetchAuthorizeUrl() - auth URL fetching
  - waitForAuthCode() - callback handling
  - exchangeCodeForTokens() - token exchange
  - parseManualInput() - manual input parsing
- **Refactoring**: Simplified model-hop.ts complexity
  - Extracted handleDowngradeDecision()
  - Extracted tryAlternativeModel()
- **Deduplication**: Created shared modules
  - lib/json-persistence.ts - file I/O with caching
  - lib/logger.ts - structured logging
  - providers/model-fetcher.ts - OpenRouter-compatible fetching
- Replaced ~30 console.log statements with structured logging
- Fixed all 9 pre-existing test failures
  - fetchWithRetry now throws after last retry
  - Fixed auth pattern matching (added key.*not.*valid)
  - Updated capability ranking tests
  - Added resetUsageStats() for test isolation

### Fixed
- fetchWithRetry() now properly throws after exhausting retries
- Auth error pattern matching now handles more message variants
- Test isolation for free-tier-limits tests

## [1.0.0] - 2024-03-28

### Added
- Initial release with 6 providers: Kilo, Zen, OpenRouter, NVIDIA, Cline, Fireworks
- Free tier usage tracking across all sessions
- Provider failover with model hopping
- Autocompact integration for rate limit recovery
- Usage widget with glimpseui
- Command toggles for free/all model filtering
- Hardcoded benchmark data from Artificial Analysis
