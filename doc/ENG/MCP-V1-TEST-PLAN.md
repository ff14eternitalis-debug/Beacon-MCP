# Beacon MCP — Complete and Structured Test Plan for v1

> Test plan to validate the MCP itself, the local `v1` installer flow, and behavior in target MCP clients before any move to a standalone `.exe` runtime.

---

## Goal

Before starting the transition to a `.exe` runtime, the current `v1` must be validated end to end.

This plan is meant to verify:

- that the MCP works correctly
- that the main tools respond properly
- that Beacon auth works
- that the `v1` installer does its job correctly
- that Codex, Claude Desktop, and Cursor can load the expected configuration

---

## Why Test Before the `.exe`

The current `v1` is the functional baseline.

If it is not stabilized, moving too early to a `.exe` will:

- make debugging harder
- hide some bugs behind packaging issues
- make test feedback less actionable

The right strategy is:

1. validate `v1`
2. fix remaining bugs
3. only then prepare the standalone runtime

---

## Plan Scope

The plan covers:

- MCP server tests
- Beacon tool tests
- authentication tests
- multi-game tests
- Sentinel tests
- Connector tests
- `v1` installer tests
- MCP client configuration tests

---

## Test Environments To Prepare

### Environment A — Local Dev

Goal:

- quickly verify behavior on the development machine

### Environment B — Clean User Setup

Goal:

- simulate an environment closer to a real user

Ideally:

- another Windows user session
- or a virtual machine
- or a dedicated test PC

### Environment C — Client by Client

Goal:

- validate each client separately:
  - Codex
  - Claude Desktop
  - Cursor

---

## Test Prerequisites

You should have:

- a valid Beacon account
- access to `https://api.usebeacon.app/v4`
- a test Beacon project if possible
- at least one installed MCP client
- optionally a Sentinel test service
- optionally a test Connector if the Connector layer must be validated

---

## Axis 1 — MCP Server Tests

### Test 1.1 — Main Project Build

Goal:

- verify that `Beacon-MCP` compiles

Expected result:

- `npm run build` succeeds

### Test 1.2 — stdio Startup

Goal:

- verify that the server starts locally in `stdio`

Expected result:

- startup without crash
- valid startup message

### Test 1.3 — HTTP Startup

Goal:

- verify that the server starts in HTTP/SSE mode

Expected result:

- `/health` responds
- `/openapi.json` responds
- `/mcp/sse` is exposed

---

## Axis 2 — Beacon Authentication Tests

### Test 2.1 — Status Without Login

Tool:

- `beacon_auth_status`

Expected result:

- clear response indicating no active login

### Test 2.2 — Device Flow Login

Tools:

- `beacon_login`
- `beacon_login_check`

Expected result:

- code generation
- browser flow can be completed
- tokens are stored locally

### Test 2.3 — Status After Login

Tool:

- `beacon_auth_status`

Expected result:

- `userId` is present
- token expiry data is coherent

### Test 2.4 — Logout

Tool:

- `beacon_logout`

Expected result:

- local session is removed

---

## Axis 3 — Projects and Configuration Tests

### Test 3.1 — Project List

Tool:

- `beacon_list_projects`

Expected result:

- valid project list or clean empty response

### Test 3.2 — Project Details

Tool:

- `beacon_get_project`

Expected result:

- readable project metadata

### Test 3.3 — `Game.ini` Read

Tool:

- `beacon_generate_game_ini`

Expected result:

- readable INI content

### Test 3.4 — `Game.ini` Write

Tool:

- `beacon_put_game_ini`

Expected result:

- success response
- no file corruption

### Test 3.5 — `GameUserSettings.ini` Read

Tool:

- `beacon_generate_game_user_settings_ini`

Expected result:

- readable content

### Test 3.6 — `GameUserSettings.ini` Write

Tool:

- `beacon_put_game_user_settings_ini`

Expected result:

- update accepted

### Test 3.7 — Config Option Listing

Tool:

- `beacon_get_config_options`

Expected result:

- options listed without error

---

## Axis 4 — Gamedata Tests

### Test 4.1 — Blueprint List

Tool:

- `beacon_list_blueprints`

### Test 4.2 — Blueprint Detail

Tool:

- `beacon_get_blueprint`

### Test 4.3 — Engram List

Tool:

- `beacon_list_engrams`

### Test 4.4 — Engram Detail

Tool:

- `beacon_get_engram`

### Test 4.5 — Creature List

Tool:

- `beacon_list_creatures`

### Test 4.6 — Creature Detail

Tool:

- `beacon_get_creature`

### Test 4.7 — Spawn Point List

Tool:

- `beacon_list_spawn_points`

### Test 4.8 — Spawn Point Detail

Tool:

- `beacon_get_spawn_point`

### Test 4.9 — Map List

Tool:

- `beacon_list_maps`

### Test 4.10 — Game Variables

Tool:

- `beacon_list_game_variables`

Expected result for all:

- no MCP crash
- parameters validated correctly
- coherent structured responses

---

## Axis 5 — Multi-Game Tests

### Test 5.1 — Palworld Config Options

Tool:

- `beacon_get_config_options`

Parameters:

- `game = palworld`

Expected result:

- accepted
- useful response

### Test 5.2 — 7DTD Config Options

Tool:

- `beacon_get_config_options`

Parameters:

- `game = 7dtd`

Expected result:

- accepted

### Test 5.3 — Palworld Game Variables

Tool:

- `beacon_list_game_variables`

Parameters:

- `game = palworld`

Expected result:

- accepted

### Test 5.4 — Out-of-Scope Project Workflows

Verify that project tools do not falsely claim support for `palworld` or `7dtd`.

Expected result:

- clean rejection or blocked validation

---

## Axis 6 — Sentinel Tests

### Test 6.1 — Service List

- `beacon_list_sentinel_services`

### Test 6.2 — Service Detail

- `beacon_get_sentinel_service`

### Test 6.3 — Group List

- `beacon_list_sentinel_groups`

### Test 6.4 — Group Detail

- `beacon_get_sentinel_group`

### Test 6.5 — Bucket List

- `beacon_list_sentinel_buckets`

### Test 6.6 — Bucket Detail

- `beacon_get_sentinel_bucket`

### Test 6.7 — Script List

- `beacon_list_sentinel_scripts`

### Test 6.8 — Script Detail

- `beacon_get_sentinel_script`

### Test 6.9 — Player List

- `beacon_list_players`

### Test 6.10 — Chat / RCON

- `beacon_send_chat`
- `beacon_run_rcon`

Expected result:

- either success
- or a clean explicit Sentinel access error

---

## Axis 7 — Connector Tests

Only run these if a test Connector is available.

### Test 7.1 — Status

- `beacon_get_server_status`

### Test 7.2 — Start

- `beacon_start_server`

### Test 7.3 — Stop

- `beacon_stop_server`

### Test 7.4 — Live Param Update

- `beacon_set_server_param`

Expected result:

- coherent behavior
- network or timeout errors mapped correctly

---

## Axis 8 — v1 Installer Tests

### Test 8.1 — Node.js Detection

Command:

- `node dist/cli.js --check-node`

Expected result:

- Node detected if present
- clear message otherwise

### Test 8.2 — App Detection

Command:

- `node dist/cli.js --detect`

Expected result:

- Codex status
- Claude status
- Cursor status

### Test 8.3 — Default Installation

Command:

- `node dist/cli.js --install-defaults --json-file ...`

Expected result:

- runtime copied
- configs patched
- result JSON written

### Test 8.4 — Backups

Expected result:

- `.bak` files created

### Test 8.5 — Idempotence

Run installation again.

Expected result:

- no duplication
- `already configured` when already in place

### Test 8.6 — Post-Install Validation

Expected result:

- `installRootExists = yes`
- `runtimeEntryExists = yes`
- `runtimeStartupOk = yes`

---

## Axis 9 — Client-by-Client Tests

### Codex

Verify:

- MCP load
- `beacon_auth_status`
- `beacon_list_projects`

### Claude Desktop

Verify:

- MCP config load
- access to `beacon_auth_status`
- Beacon login

### Cursor

Verify:

- loaded written config
- no conflict with existing config
- at least one Beacon tool works

---

## Axis 10 — Non-Regression Tests

Keep a minimum non-regression checklist:

- no duplication in `config.toml`
- no JSON corruption for Claude / Cursor
- no overwrite of existing MCP servers
- no startup crash
- no validation error on simple tools

---

## Axis 11 — Error Message Tests

Errors should stay understandable when:

- Beacon is not connected
- Sentinel access is denied
- Node is missing
- Connector is unavailable
- a client is not installed
- a config file is not writable

---

## Recommended Execution Order

1. build MCP
2. build `installer/`
3. run `--check-node`
4. run `--detect`
5. run `--install-defaults`
6. test Codex
7. test Claude Desktop
8. test Cursor
9. test Beacon auth
10. test projects/config
11. test gamedata
12. test multi-game
13. test Sentinel
14. test Connector if available

---

## Validation Criteria Before Moving to `.exe`

You should move to `.exe` work only if:

- the MCP starts cleanly
- auth works
- critical tools respond
- config patchers are stable
- the `v1` installer is idempotent
- Codex / Claude / Cursor have each been validated at least once

---

## Recommended Deliverable For This Phase

This phase should produce:

- a checked test checklist
- a list of remaining bugs
- a list of potential packaging blockers
- a clear decision: `v1 stable` or `v1 still needs fixes`

---

## Final Recommendation

Before any transition to `Beacon-MCP.exe`, `v1` should be treated as the product reference baseline.

In practice:

> first validate the MCP and the `v1` installer, then move to the standalone runtime transition.
