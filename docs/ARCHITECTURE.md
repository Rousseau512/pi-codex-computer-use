# Architecture

This extension bridges Pi tools to OpenAI Codex Computer Use without implementing desktop automation itself. Codex app-server owns the plugin lifecycle and provides a persistent Node REPL. The extension loads the installed ChatGPT Computer Use runtime into that REPL and maps Pi's typed tools to its `sky` API.

```text
Pi extension (src/index.ts)
  -> Codex app-server (codex app-server --listen stdio://)
    -> node_repl MCP server
      -> installed Computer Use plugin wrapper
        -> signed ChatGPT Computer Use runtime
          -> local desktop
```

## Why app-server and Node REPL

The current ChatGPT Computer Use plugin exposes its supported integration through a plugin-owned Node REPL wrapper rather than a standalone `computer-use` MCP server. App-server supplies the persistent REPL, plugin discovery, thread lifecycle, and permission handling. The extension calls only the known `sky` methods and never implements accessibility or input synthesis itself.

## Module map

| Module | Responsibility |
| --- | --- |
| `src/index.ts` | Extension entry: registers tools, `/computer-use` commands, session lifecycle hooks |
| `src/runtime.ts` | Lazy runtime state machine: spawn/connect, idle shutdown, elicitation bridging, footer status |
| `src/app-server-client.ts` | JSONL request/response client over the spawned `codex app-server` process |
| `src/protocol.ts` | Narrow TypeScript types for the app-server methods we use |
| `src/thread-manager.ts` | One ephemeral Codex thread per runtime; reset on restart/`/new`/`/fork`/`/reload` |
| `src/computer-use-backend.ts` | Maps typed tools to plugin-owned `sky` calls through `node_repl`, normalizes content, retries stale threads |
| `src/computer-use-tools.ts` | Pi tool registration with TypeBox schemas, queue, content conversion |
| `src/queue.ts` | Promise-chain queue serializing all Computer Use calls |
| `src/content.ts` | MCP content -> Pi content blocks (text truncation, image preservation) |
| `src/status.ts` | Readiness checks and `/computer-use status` formatting |
| `src/footer-status.ts` | Pi footer status line (`Computer Use: idle/ready/<app>/…`) |
| `src/log.ts` | Opt-in debug logging with sensitive-field redaction |

## App-server protocol

Messages are newline-delimited JSON objects (`{id, method, params}`) — no `Content-Length` framing. The verified flow:

1. Spawn: `codex app-server --listen stdio://`
2. Initialize:

   ```json
   {"id":1,"method":"initialize","params":{"clientInfo":{"name":"...","version":"..."},"capabilities":{"experimentalApi":true}}}
   ```

3. Check plugin state with `plugin/list`, then read the installed plugin's local source path.
4. Start an ephemeral thread:

   ```json
   {"id":3,"method":"thread/start","params":{"cwd":"...","ephemeral":true}}
   ```

5. Call `node_repl.js` through app-server. The generated code loads the plugin-owned `scripts/computer-use-client.mjs` once, invokes the requested `sky` method, and returns text or screenshot content:

   ```json
   {"id":4,"method":"mcpServer/tool/call","params":{"server":"node_repl","tool":"js","threadId":"<id>","arguments":{"code":"..."}}}
   ```

Other methods used: `marketplace/add`, `plugin/install`, `config/mcpServer/reload`, and `mcpServerStatus/list`. Method names are centralized in `src/protocol.ts` to limit version-drift surface.

The bundled plugin is discovered from app-server metadata rather than a hard-coded versioned cache path.

## Thread management

`mcpServer/tool/call` requires a thread ID known to app-server. The extension keeps one ephemeral thread per runtime, reuses it for all calls, and recreates it when app-server restarts or the Pi session changes (`/new`, `/fork`, `/reload`). If a call fails with `thread not found` / invalid thread ID (app-server forgot the ephemeral thread), the backend resets the thread and retries once.

## Permission / elicitation bridge

App-server sends server-requests like:

```json
{"method":"mcpServer/elicitation/request","id":0,"params":{"serverName":"computer-use","message":"Allow Codex to use Finder?"}}
```

Flow:

1. `AppServerClient` surfaces the request to the runtime.
2. With UI available, the runtime asks via `ctx.ui.confirm()` and replies `accept` / `decline` / `cancel`.
3. With no UI (print mode), the request is declined — fail closed.
4. Dev-only exception: apps on the `PI_CUA_DEV_AUTO_ACCEPT_APPS` allowlist are auto-accepted. Accepted grants may persist in Codex's own permission store.

## Content conversion

`get_app_state` returns text (accessibility tree) plus a base64 JPEG screenshot. Conversion rules (`src/content.ts`):

- Text blocks pass through with Pi truncation conventions for huge trees.
- Image blocks are preserved untruncated; missing MIME types default to `image/jpeg` (observed Codex output omits it).
- Screenshots/base64 are never logged.

## Concurrency

Pi may execute tool calls in parallel; desktop automation must not. All Computer Use calls flow through a single promise-chain queue in the tools layer, so click/type/scroll sequences never interleave.

## Runtime lifecycle

The runtime is lazy: nothing spawns until a `/computer-use` command or `computer_use_*` tool needs the backend. Cleanup is triggered by the agent finishing its turn, `/computer-use disable`/`restart`, Pi session shutdown, or the idle timeout (`PI_CUA_IDLE_TIMEOUT_MS`, default 10 minutes). Shutting down the app-server client also tears down the spawned `SkyComputerUseClient` process.

## Version drift

Codex Computer Use and app-server APIs may change between releases. Tool schemas are static definitions for the known tool surface; `/computer-use status` reports the Codex CLI version, plugin state, MCP server status, and live tool list so drift is visible. If the live tool list diverges from the static schemas, that's the signal to update `src/computer-use-tools.ts`.
