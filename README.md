# pi-codex-computer-use

A [Pi](https://github.com/earendil-works/pi-coding-agent) extension that exposes OpenAI Codex Computer Use as Pi-native tools, so Pi agents can inspect and operate local macOS apps — reading accessibility trees and screenshots, then clicking, typing, scrolling, and pressing keys.

The extension talks to Codex app-server, which owns the Computer Use plugin lifecycle and native permission flow:

```text
Pi tool -> Codex app-server -> Node REPL -> ChatGPT Computer Use runtime -> local desktop
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit together.

## Requirements

- macOS
- [Pi](https://github.com/earendil-works/pi-coding-agent)
- Codex CLI on `PATH` as `codex`
- ChatGPT.app installed at `/Applications/ChatGPT.app`
- Codex Computer Use plugin installed, or installable from the bundled marketplace (`/computer-use install` handles this)
- macOS Accessibility and Screen Recording permissions granted to Codex Computer Use when prompted
- Preferably a vision-capable model, because `computer_use_get_app_state` returns screenshots

## Installation

Install from npm:

```bash
pi install pi-codex-computer-use
```

Or install a local checkout:

```bash
pi install ./path/to/pi-codex-computer-use
```

Or add it to project settings (`.pi/settings.json`):

```json
{
  "packages": ["pi-codex-computer-use"]
}
```

Then, inside Pi, verify the backend is ready:

```text
/computer-use status
```

If the plugin is missing, `/computer-use install` adds the bundled Codex marketplace, installs the `computer-use` plugin, and reloads MCP servers.

## Usage

Ask Pi to do something on your desktop:

```text
Use Computer Use to open Calculator and compute 4 + 5.
```

The bundled `computer-use` skill teaches the model the standard loop: get app state, act, get app state again, verify.

### Slash commands

| Command | What it does |
| --- | --- |
| `/computer-use status` | Read-only check of Codex CLI, app-server, plugin, MCP server, and tools |
| `/computer-use install` | Add bundled marketplace if needed, install/enable the plugin, reload MCP servers |
| `/computer-use reload` | Reload Codex MCP servers and recheck status |
| `/computer-use restart` | Shut down the runtime; next tool use lazy-starts it again |
| `/computer-use enable` | Re-add the Computer Use tools to Pi's active tool set |
| `/computer-use disable` | Remove the tools and shut down the runtime (session-local) |
| `/computer-use diagnose` | Status plus environment and permission hints |

### Lifecycle

The extension lazy-starts Codex app-server only when a command or `computer_use_*` tool needs it. The Pi footer reflects the current state:

- `Computer Use: idle` — nothing running (normal startup state)
- `Computer Use: <app>` — a tool call is operating that app
- `Computer Use: permission…` — waiting on a user permission prompt
- `Computer Use: ready` — backend up, last call succeeded
- `Computer Use: disabled` — tools removed via `/computer-use disable`

The runtime shuts itself down when the agent finishes its turn, and after an idle timeout (default 10 minutes) as a fallback.

## Tools

All tools proxy one-to-one to the Codex `computer-use` MCP server. Calls are serialized through a single queue — desktop actions never run concurrently, even if the model emits parallel tool calls.

| Tool | Purpose |
| --- | --- |
| `computer_use_list_apps` | List running/launchable apps |
| `computer_use_get_app_state` | Accessibility tree + screenshot for an app |
| `computer_use_click` | Click an element index or coordinates |
| `computer_use_type_text` | Type into the focused field |
| `computer_use_press_key` | Press a key or key combo (e.g. `super+s`) |
| `computer_use_scroll` | Scroll a scrollable element |
| `computer_use_drag` | Drag between points |
| `computer_use_set_value` | Set a control's value directly |
| `computer_use_select_text` | Select text in a text area |
| `computer_use_perform_secondary_action` | Element's secondary (e.g. context-menu) action |

## Configuration

| Environment variable | Default | Effect |
| --- | --- | --- |
| `PI_CUA_DEBUG` | unset | `1` writes debug logs to stderr |
| `PI_CUA_LOG` | unset | Path to append structured debug logs |
| `PI_CUA_IDLE_TIMEOUT_MS` | `600000` | Idle time before the runtime auto-shuts-down |
| `PI_CUA_DEV_AUTO_ACCEPT_APPS` | unset | Dev-only comma-separated app allowlist for auto-accepting app access prompts |

## Safety

Computer Use operates your live desktop. Defaults are conservative:

- Codex app-server permission requests ("Allow Codex to use Finder?") are bridged to Pi UI confirmations.
- With no UI available (e.g. print mode), permission requests fail closed and are declined.
- The bundled skill instructs the model to confirm with you before risky UI actions: sending messages, submitting forms, deleting data, payments, account/security changes, installing software, or transmitting sensitive data.
- Logs redact screenshot/base64/text-like fields by default.

`PI_CUA_DEV_AUTO_ACCEPT_APPS` is for development against safe apps (Finder, TextEdit, Calculator) only. Note that accepted app access can persist in Codex's own permission store across runs. Do not use broad auto-approval.

## Troubleshooting

Run `/computer-use diagnose` first — it prints status plus actionable hints.

| Symptom | Likely cause / fix |
| --- | --- |
| `codex_missing` | Codex CLI not on `PATH`; install Codex CLI |
| `marketplace_missing` | ChatGPT.app not at `/Applications/ChatGPT.app`, or bundled marketplace path missing |
| `plugin_not_installed` / `plugin_disabled` | Install Computer Use from ChatGPT's plugin marketplace or run `/computer-use install` |
| `mcp_missing` | Plugin installed but the Node REPL bridge is unavailable; try `/computer-use reload` |
| Tool calls hang or error with permission messages | Grant Accessibility and Screen Recording to Codex Computer Use in macOS System Settings |
| Permission prompts never appear in print mode | Expected: no-UI mode fails closed; run interactively or use the dev allowlist for safe apps |
| `thread not found` errors | Handled automatically (thread reset + one retry); persistent failures suggest app-server instability — `/computer-use restart` |

Debug logging:

```bash
PI_CUA_DEBUG=1 PI_CUA_LOG=/tmp/pi-codex-computer-use.log pi -e .
```

## Limitations

- macOS only.
- Requires the Codex app and its bundled Computer Use plugin; this extension does not implement its own desktop automation.
- Codex app-server and Computer Use APIs may drift between Codex versions; `/computer-use status` reports versions and tool lists to help spot drift.
- `/computer-use disable` is session-local; new Pi sessions re-enable the tools.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow and [docs/TESTING.md](docs/TESTING.md) for the test matrix. Contributions from humans and automated agents are welcome — agents should also read [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)
