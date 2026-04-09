# Beacon MCP — Codex Smoke Tests

> Quick checks to confirm that `Beacon-MCP` is properly loaded in Codex and that the main tools respond correctly.

---

## Goal

This document validates 4 things:

- Codex can see the `beacon` MCP server
- the server starts without crashing
- Beacon authentication works
- the most important tools respond correctly

---

## Prerequisites

- Codex has been restarted after adding the MCP server to [config.toml](C:\Users\forgo\.codex\config.toml)
- the build exists at [dist\index.js](C:\Users\forgo\Documents\Code\Projet-Beacon\Beacon-MCP\dist\index.js)
- internet access works for `https://api.usebeacon.app/v4`

---

## Test 1 — MCP Detection

In Codex, ask:

```text
Check whether the Beacon MCP is available and list its authentication tools.
```

Expected result:

- Codex uses `beacon_*` tools
- at minimum, these tools are visible or usable:
  - `beacon_login`
  - `beacon_login_check`
  - `beacon_auth_status`
  - `beacon_logout`

Typical failure:

- Codex cannot see any `beacon_*` tools

Interpretation:

- either the MCP server was not reloaded
- or the path in [config.toml](C:\Users\forgo\.codex\config.toml) is incorrect

---

## Test 2 — Authentication Status

In Codex, ask:

```text
Call beacon_auth_status and tell me whether Beacon is already connected.
```

Expected result:

- structured response
- no MCP crash
- if connected: `userId` and token expiry timestamps are present
- if not connected: a clear state says login is required

Typical failure:

- global MCP error
- tool not found
- server crash

---

## Test 3 — Interactive Login

If test 2 shows you are not connected, ask Codex:

```text
Run beacon_login and help me complete the Beacon login.
```

Then:

1. copy the returned short code
2. open `https://usebeacon.app/device`
3. enter the code
4. come back to Codex and ask:

```text
Call beacon_login_check.
```

Expected result:

- login completes successfully
- tokens are stored locally
- `beacon_auth_status` then reports a connected state

---

## Test 4 — Simple Project Read

In Codex, ask:

```text
Call beacon_list_projects and summarize the result.
```

Expected result:

- list of projects or a clean empty response
- no crash
- text output plus structured data

Typical failure:

- `401`
- authentication error

Interpretation:

- rerun the login flow

---

## Test 5 — Simple Gamedata Read

In Codex, ask:

```text
Call beacon_list_maps for arksa.
```

Expected result:

- a list of ArkSA maps is returned
- parameters are validated correctly
- no tool schema error occurs

This validates that:

- MCP tools are registered correctly
- argument enums work
- standard API calls succeed

---

## Test 6 — Simple Sentinel Read

In Codex, ask:

```text
Call beacon_list_sentinel_services and summarize the result.
```

Expected result:

- either a service list
- or a clean message describing a Sentinel access issue

This test is useful to validate:

- the Sentinel layer
- `403` error mapping
- structured response formatting

---

## Test 7 — Multi-Game Config Options

In Codex, ask:

```text
Call beacon_get_config_options for palworld with a filter on server.
```

Expected result:

- valid response
- no rejection on the `game` value
- proof that multi-game expansion is actually active

---

## Recommended Minimal Sequence

If you want a fast pass, only run:

1. `beacon_auth_status`
2. `beacon_list_projects`
3. `beacon_list_maps` with `arksa`
4. `beacon_get_config_options` with `palworld`

If these 4 tests pass, the MCP is broadly good for Codex.

---

## Symptoms to Watch

- no visible `beacon_*` tools
- MCP server startup error
- argument validation errors on simple calls
- repeated `401` after login
- Sentinel `403` on non-Sentinel tools

---

## Conclusion

The smoke test is successful if:

- Codex can call Beacon tools
- `beacon_auth_status` works
- at least one `projects` tool, one `gamedata` tool, and one multi-game tool respond correctly
- no MCP load error appears during the session
