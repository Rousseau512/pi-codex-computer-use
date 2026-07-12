# Testing matrix

Negative-path and edge-case checklist for the extension. Use it when hardening a module, reviewing a PR that touches one of these areas, or hunting regressions. See [CONTRIBUTING.md](../CONTRIBUTING.md) for the test layers (unit → probes → Pi smoke → real desktop) and which of these can be covered where.

Stable failure reasons referenced below (`codex_missing`, `plugin_not_installed`, …) are defined in `src/status.ts`.

## 1. Codex CLI / app-server

- `codex` not on `PATH` — expect `codex_missing` with an actionable install message.
- `codex --version` hangs or fails.
- `codex app-server --listen stdio://` fails to spawn.
- App-server starts then exits immediately.
- App-server writes malformed JSON.
- App-server never responds to a request (timeout path).
- App-server returns a JSON-RPC error.
- App-server dies during a tool call.
- Multiple concurrent requests get responses routed correctly by `id`.

## 2. Codex app bundle / marketplace

- `/Applications/ChatGPT.app` missing — expect a clear install/source hint.
- Bundled marketplace path missing (`/Applications/ChatGPT.app/Contents/Resources/plugins/openai-bundled`).
- Marketplace exists but has no `computer-use` entry.
- `plugin/list` returns only a remote marketplace entry.
- Multiple marketplaces contain `computer-use` / ambiguous match.
- `marketplace/add` fails.
- `plugin/install` fails.
- Plugin install succeeds but MCP reload fails.

## 3. Plugin state

- `computer-use` not installed — expect `plugin_not_installed`.
- Installed but disabled — expect `plugin_disabled`.
- Installed/enabled but wrong or incompatible version.
- Installed/enabled but `.mcp.json` bad or missing.
- Plugin cache path missing or corrupted, or source points to stale cache.

## 4. MCP server availability

- `mcpServerStatus/list` missing `node_repl` — expect `mcp_missing`.
- `node_repl` exists but does not expose `js`.
- Node REPL startup stuck in `starting`, or startup error notification arrives.
- `node_repl.js` returns `isError: true`.
- `node_repl.js` times out.
- Stale thread ID returns `thread not found` — expect one reset-and-retry; retry failure surfaces the error.

## 5. Codex thread management

- `thread/start` fails, or returns malformed response / no thread id.
- App-server forgets the ephemeral thread, or restarts between calls.
- Multiple parallel Pi tool calls racing to create a thread.
- Session switch / `/new` / `/fork` / `/reload` resets the thread.

## 6. Permission / elicitation

- `mcpServer/elicitation/request` in UI mode: user accepts; declines; dialog aborted.
- Same request in no-UI mode — expect decline / fail closed.
- Unknown server request method — expect safe rejection.
- Malformed elicitation request.
- Multiple simultaneous elicitation requests.
- `PI_CUA_DEV_AUTO_ACCEPT_APPS`: exact allowlisted app accepted; non-allowlisted declined or prompted; app names with punctuation/spaces; broad/empty values must not accept all.
- Persisted Codex app access from previous runs changes prompt behavior.

## 7. macOS permissions / desktop environment

- Accessibility permission missing; Screen Recording missing; one granted but not the other.
- No graphical session / no active desktop.
- Target app not running, invalid path, no windows, or minimized/hidden.
- Protected/sensitive app (e.g. 1Password).
- Computer Use app/service crashed or not responding (`Native hook relay unavailable`).
- Tool call hangs because the native bridge stalls.

## 8. Tool argument validation

For each tool: missing required args; wrong types; invalid enum values; extra unknown fields. Plus:

- bad element index; stale element index after UI changed;
- coordinates outside screenshot bounds;
- scroll on a non-scrollable element; set_value on a non-settable element;
- select_text target absent, or ambiguous without prefix/suffix;
- type_text with empty / very large string;
- press_key with invalid key syntax;
- click with neither element nor coordinates, or both.

## 9. Content conversion

- Text only; image only; text + image; empty content array; non-array content; malformed result.
- Missing image MIME type (defaults to `image/jpeg`).
- Unsupported content block type.
- Huge accessibility tree text (truncated); huge base64 image (preserved, never logged).
- `isError: true` with and without text.

## 10. Queue / concurrency

- Multiple read-like calls in parallel; multiple mutating calls in parallel — all serialized.
- First queued call fails; second still runs.
- Queued call times out.
- Shutdown or disable while the queue has pending calls.
- User abort while a tool call is in flight.

## 11. Commands / UX

- `/computer-use status` in print mode, and while tools are disabled (must say so).
- `enable`/`disable` idempotent; `disable` while app-server active; `restart` while a tool call is active.
- `install` when already installed; `install` when marketplace missing.
- `reload` when app-server unavailable.
- Unknown subcommand; autocomplete lists expected commands.

## 12. Install / packaging

- Project-local install works; global install works; `pi -e .` works; `pi install .` works.
- Package loads without hidden `node_modules` assumptions.
- `.pi/settings.json` project trust behavior.
- Extension hot reload via `/reload`.
- Published package includes skill and extension paths, and no sensitive or dev-only files.
