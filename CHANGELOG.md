# Changelog

All notable changes to this project are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Route Computer Use through ChatGPT's plugin-owned Node REPL runtime.
- Discover the installed plugin path from Codex app-server metadata.
- Detect `/Applications/ChatGPT.app` and the `node_repl` bridge in status checks.

## [0.1.0] - 2026-06-09

Initial release.

### Added

- Pi tools proxying the full Codex Computer Use surface: `computer_use_list_apps`, `computer_use_get_app_state`, `computer_use_click`, `computer_use_type_text`, `computer_use_press_key`, `computer_use_scroll`, `computer_use_drag`, `computer_use_set_value`, `computer_use_select_text`, `computer_use_perform_secondary_action`.
- `/computer-use` command surface: `status`, `install`, `reload`, `restart`, `enable`, `disable`, `diagnose`.
- Codex app-server JSONL client with request timeouts and server-request routing.
- Ephemeral Codex thread management with stale-thread reset-and-retry.
- Permission/elicitation bridge to Pi UI confirmations; fails closed without UI.
- Dev-only safe-app auto-accept via `PI_CUA_DEV_AUTO_ACCEPT_APPS`.
- Serialized tool queue preventing concurrent desktop actions.
- Content conversion preserving screenshots and truncating large accessibility trees.
- Lazy runtime lifecycle with footer status and idle auto-shutdown (`PI_CUA_IDLE_TIMEOUT_MS`).
- `computer-use` skill teaching the inspect-act-verify loop and risky-action confirmation policy.
- Debug logging with sensitive-field redaction (`PI_CUA_DEBUG`, `PI_CUA_LOG`).
- Probe scripts and tmux dev workflow.
