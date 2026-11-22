# Cuby app packages

An app package is a self-contained vertical integration: an MCP server plus an
optional MCP Apps UI. Cuby discovers it, starts its server, registers its tools
with the agent, and renders tool results that point at a `ui://` resource in a
sandboxed iframe.

This is the v1 host contract. Runtime installation, signatures, a full UI kit,
skills/entry points, and OS-level server sandboxing are not part of v1.

## Directory layout

```text
apps/<id>/
  app.json          # manifest (required)
  server/           # MCP server sources (or server.mjs at the root)
  ui/               # UI source or build output
  runtime/          # bundled Python/Node runtime (optional)
  assets/           # icons and static assets (optional)
  tests/            # app-owned tests (optional)
```

Cuby discovers apps from:

- `CUBY_BUNDLED_APPS_DIR` (packaged `resources/apps`, read via `registry.json`)
- `CUBY_USER_APPS_DIR` (default `~/.cuby/apps`)
- `CUBY_DEV_APPS` (comma-separated local app directories, highest precedence)

Development entries override bundled and user apps with the same `id`.

## Minimal `app.json`

```json
{
  "schemaVersion": 1,
  "id": "fixture",
  "name": "Fixture",
  "version": "0.0.1",
  "engines": { "cuby": ">=0.0.1" },
  "server": {
    "scope": "session",
    "transport": "stdio",
    "command": "node",
    "args": ["server.mjs"],
    "cwd": "${APP_ROOT}"
  },
  "ui": {
    "resources": [
      { "uri": "ui://fixture/hello", "entry": "ui/index.html" }
    ],
    "defaultResourceUri": "ui://fixture/hello",
    "prefersBorder": true,
    "csp": {}
  },
  "capabilities": {
    "appToolCalls": ["echo"],
    "appMessages": "allow",
    "workspace": "none"
  }
}
```

`server.scope` is `"global"` (one process for the whole app, the default) or
`"session"` (one process per chat). Use `"session"` when the server keeps
per-conversation state; `${SESSION_WORKSPACE}` is only available in that mode.

Placeholders allowed in `server.command` / `args` / `cwd` / `env`:

| Placeholder | Value |
|---|---|
| `${APP_ROOT}` | app package root |
| `${APP_DATA}` | persistent app data directory |
| `${SESSION_WORKSPACE}` | current chat workspace (session scope only) |
| `${CUBY_USER_DATA}` | Cuby user-data root |

Unknown placeholders and `${SESSION_WORKSPACE}` without a session/workspace
capability are rejected by manifest validation. Plaintext secrets in
`server.env` are rejected; declare them in `credentials` and Cuby injects them.

## What the server must implement

A stdio MCP server that answers:

- `initialize`
- `tools/list`
- `tools/call`
- `resources/list`
- `resources/read`

Every tool that renders UI declares:

```js
_meta: { ui: { resourceUri: "ui://fixture/hello" } }
```

The URI must appear in `ui.resources[]`. `resources/read` for that URI must
return `text/html;profile=mcp-app` HTML. The HTML is loaded into an iframe with
`sandbox="allow-scripts"` (no `allow-same-origin`); CSP defaults to no network
access unless `ui.csp` declares domains.

## What the UI can do

The UI speaks the standard MCP Apps protocol (`2026-01-26`) over
`postMessage`. The host answers:

- `ui/initialize`
- `tools/call`
- `resources/read`
- `ui/message`
- `ui/open-link`
- `ui/download-file`
- `ui/request-display-mode`
- `ui/update-model-context` (accepted, not stored in v1)

The host sends:

- `ui/notifications/tool-input`
- `ui/notifications/tool-result`
- `ui/notifications/host-context-changed`
- `ui/resource-teardown`

`ui/message` enters the chat as a user message only when
`capabilities.appMessages` is `"allow"`; `"ask"` is treated as denied in v1
because the confirmation UI is not implemented. The message carries
`source: "mcp-app"`, `appId`, `viewId`, and `appControlled: true`, is rate
limited to 10 messages per minute per view, and is rendered with its app id.
Reverse `tools/call` requests are restricted to this app's server and to
`capabilities.appToolCalls`.

`ui/open-link` and `ui/download-file` are advertised only when
`capabilities.openLinks` / `capabilities.downloads` are `true`. Downloads go
through the native save dialog; links require confirmation. The iframe CSP is
`default-src 'none'` unless `ui.csp` declares domains.

Tool results larger than 256 KiB, or containing images, are externalized under
`${APP_DATA}/views/<viewId>/`; the transcript stores a reference and the UI
reloads the full result when it mounts.

## Development

```sh
CUBY_DEV_APPS=apps/fixture npm run dev:desktop
```

Ask the model to call `mcp_fixture_hello` with `{"name":"Cuby"}`. The fixture
UI stays visible after the activity cluster collapses, can call `echo` through
the bridge, and can send a `ui/message`.

## Build selection

Select apps in `cuby.apps.json`:

```json
{ "schemaVersion": 1, "apps": ["fixture"] }
```

Or select on the command line / environment:

```sh
CUBY_APPS=fixture npm run apps:build
node scripts/apps/build-apps.mjs --apps fixture --out dist/apps
npm run apps:list
```

The build validates each manifest, checks that `server.command` has an entry for
the current `process.platform-process.arch`, runs `build.ui` if declared, and
stages `dist/apps/<id>/` with a `registry.json`. Apps that cannot run on the
current platform are skipped; set `CUBY_APPS_STRICT=1` to fail instead.

## Security rules

- The app server is trusted build-time code in v1. Do not install third-party
  app packages without an OS sandbox.
- The UI iframe is sandboxed with scripts only; no same-origin access.
- Network access is denied by default through a CSP meta tag; only `ui.csp`
  domains are allowed.
- Reverse tool calls are allowlisted per app; cross-app calls are not possible.
- `ui/message` requires the `"allow"` capability, is rate limited, and is
  marked as app-originated in the transcript.
- `ui/download-file` and `ui/open-link` require the matching capability;
  downloads are size limited and saved through the desktop save dialog.

## Not in v1

- Runtime installation, signing, and updates
- OS-level sandboxing of app servers
- Skills, home/settings entry points, and a shared UI kit
- Python/Node runtime bundling inside app packages
- electron-builder packaging of `dist/apps`
- The FinanceBuddy migration

See `docs/superpowers/specs/2026-11-21-cuby-app-packages-design.md` for the
full design and `apps/fixture` for a working reference.
