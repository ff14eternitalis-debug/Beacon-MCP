# Beacon MCP

![Status](https://img.shields.io/badge/status-active-green)
![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-20+-5FA04E?logo=node.js&logoColor=white)
![MCP SDK](https://img.shields.io/badge/MCP%20SDK-1.28-blueviolet)
![License](https://img.shields.io/badge/license-ISC-blue)

`Beacon-MCP` is a local MCP server that connects AI assistants to the [Beacon](https://usebeacon.app) game server management platform.

It is designed primarily for:

- Codex
- Claude Desktop
- Cursor

The project currently supports:

- local `stdio` MCP usage
- Beacon API v4 integration
- project and config workflows
- game data exploration
- Sentinel exploration and actions
- local Connector control
- a first Windows installer `v1` foundation

---

## Current State

The MCP itself is functional and already includes:

- structured tool responses
- OAuth device flow authentication
- project listing and project metadata
- project creation with a basic map mask
- safe project mod activation/deactivation
- safe engram unlock overrides
- native loot project inspection and copy tools
- direct chat export for project code
- local file export for large project code
- smart export that chooses chat or local file automatically
- `Game.ini` read/write
- `GameUserSettings.ini` read/write
- config option listing
- command-line option discovery
- richer game data tooling
- Sentinel discovery tools
- Connector TCP tools
- cautious multi-game support

Current supported game scope:

- `ark`
- `arksa`
- `palworld` for selected read-only tools
- `7dtd` for selected config discovery tools

Current packaging state:

- terminal installation is available now
- a Windows installer `v1` is under active construction
- a standalone `.exe` runtime is planned, but not yet the default distribution mode

---

## Main Goal

The long-term product goal is simple:

- install locally
- connect Beacon
- use Beacon workflows from an AI assistant without manual config editing

The current practical path is:

- use the MCP locally through `stdio`
- validate the `v1` installer flow
- then transition later to a standalone `.exe` runtime

---

## Compatibility

Recommended local clients:

- Codex
- Claude Desktop
- Cursor

Notes:

- local `stdio` is the primary target
- ChatGPT local MCP usage is not the target
- HTTP/SSE mode exists, but local client usage is the main focus

---

## Installation

There are now three practical installation paths to know about:

### 1. Current method — terminal installation

This is the method available today.

Typical setup:

```bash
git clone https://github.com/ff14eternitalis-debug/Beacon-MCP.git
cd Beacon-MCP
npm install
npm run build
```

Then configure your MCP client to launch:

```text
node C:\path\to\Beacon-MCP\dist\index.js
```

### 2. Current developer helper — installer runner

This path is useful if you want to test the installer logic before the graphical Windows setup is ready.

Build the installer workspace:

```bash
cd installer
npm run build
```

Useful commands:

```bash
node dist/cli.js --detect
node dist/cli.js --check-node
node dist/cli.js --install-defaults
```

This developer-oriented runner can already:

- detect Codex, Claude Desktop, and Cursor
- copy the local Beacon MCP runtime
- patch supported MCP client configs
- validate the installed runtime

### 3. Future method — Windows installer / `.exe`

This path is being prepared.

The installer work already includes:

- client detection
- config patching
- runtime copy
- Node.js prerequisite check for `v1`
- Inno Setup groundwork

For a full user-facing guide, see:

- [Installation Guide](doc/ENG/MCP-INSTALLATION-GUIDE.md)

---

## Safe Project Editing

The MCP now includes guarded project editing tools for common Beacon workflows:

- `beacon_set_project_mod` activates or disables a mod in a project without overwriting the other configured mods.
- `beacon_set_engram_unlock` adds or updates an engram override, for example unlocking `CS Tek Forge` at level `180`.
- `beacon_inspect_loot_project` reads the native Beacon loot structure of a project and summarizes overrides, reusable families, sets, and item pools.
- `beacon_copy_loot_overrides` copies selected loot overrides from one project to another while merging the required content packs.
- `beacon_copy_loot_family` copies a whole reusable loot family from a source project into a target project.
- `beacon_set_loot_override` writes a native Beacon loot override payload directly into a project.
- `beacon_export_project_code` returns `Game.ini`, `GameUserSettings.ini`, or only useful override lines directly in the assistant chat.
- `beacon_export_project_file` writes the exported config to a local `.txt` file when the output is too large for a comfortable chat response.
- `beacon_export_project_smart` chooses automatically between inline chat output and a local `.txt` export depending on the output size.

These tools are designed to be used through an assistant conversation rather than as blind writes. A good assistant flow is:

```text
User: Create an ArkSA project to unlock Tek Forge at level 180.
Assistant: Which map?
Assistant: Which mod contains Tek Forge?
Assistant: Confirm: ArkSA project, The Island, Cybers Structures QoL+, CS Tek Forge level 180?
```

Only after confirmation should the assistant call the write tools.

Guardrails currently implemented:

- verifies the project belongs to the connected Beacon user with the `Owner` role
- verifies the requested game matches the project game
- verifies mods through Beacon content packs
- asks for confirmation through `contentPackId` if a mod name has multiple matches
- preserves existing mod selections instead of replacing them
- preserves existing engram overrides and updates only the matching engram
- creates a local `.beacon` backup before writes by default
- reloads the project after writing to confirm the requested change

Local backups are written to:

```text
~/.beacon-mcp/backups/
```

Large local exports are written to:

```text
~/.beacon-mcp/exports/
```

Project targeting is now simpler for non-technical users:

- most project tools accept `projectName` instead of `projectId`
- source/target loot copy tools also accept `sourceProjectName` and `targetProjectName`
- `beacon_find_project` can search by partial name before any write or export step
- if multiple projects have the same or a very similar name, the MCP returns a clarification error listing the matching IDs
- if the name is unique for the connected user, the MCP resolves it automatically

Recommended assistant behavior for natural requests:

- if the user says "inspecte mon projet loot Astraeos", first call `beacon_find_project query="loot Astraeos"`
- if there is one clear result, continue with `projectName`
- if there are several close results, ask the user which displayed project name is the right one
- only fall back to `projectId` when two projects are genuinely ambiguous

Example workflow for Cybers Structures QoL+ Tek Forge:

```text
Call beacon_find_project query="test 180" game="arksa"
Call beacon_search_mods game="arksa" query="Cybers Structures QoL+"
Call beacon_list_engrams game="arksa" filter="tek forge" contentPackId="<contentPackId>"
Call beacon_create_project game="arksa" name="test 180" mapMask=1
Call beacon_set_project_mod game="arksa" projectName="test 180" contentPackId="<contentPackId>"
Call beacon_set_engram_unlock game="arksa" projectName="test 180" engramId="<engramId>" level=180
```

Example export requests:

```text
Call beacon_export_project_code projectName="test tek forge 180" game="arksa"
Call beacon_export_project_code projectName="test tek forge 180" game="arksa" format="overrides_only"
Call beacon_export_project_file projectName="test tek forge 180" game="arksa" file="all"
Call beacon_export_project_smart projectName="test tek forge 180" game="arksa" format="overrides_only"
```

Example direct INI workflow by project name:

```text
Call beacon_generate_game_ini projectName="test tek forge 180" game="arksa"
Call beacon_put_game_ini projectName="test tek forge 180" game="arksa" content="..."
Call beacon_generate_game_user_settings_ini projectName="test tek forge 180" game="arksa"
Call beacon_put_game_user_settings_ini projectName="test tek forge 180" game="arksa" content="..."
```

Example native loot workflow:

```text
Call beacon_find_project query="Loot Aérien Astraeos" game="arksa"
Call beacon_inspect_loot_project projectName="[ARCHIVE] LOOTS /// RILINDRA Loot Aérien Astraeos [EXTRAIT]" game="arksa"
Call beacon_copy_loot_family sourceProjectName="[ARCHIVE] LOOTS /// RILINDRA Loot Aérien Astraeos [EXTRAIT]" targetProjectName="My Astraeos Loot Test" game="arksa" family="Astraeos Blue"
Call beacon_copy_loot_overrides sourceProjectName="[ARCHIVE] LOOTS /// RILINDRA Loot Aérien Astraeos [EXTRAIT]" targetProjectName="My Astraeos Loot Test" game="arksa" lootDropClassStrings=["SupplyCrate_Level60_Astraeos_C"]
Call beacon_set_loot_override projectName="My Astraeos Loot Test" game="arksa" override="{...payload Beacon...}"
```

Recommended export behavior:

- use `beacon_export_project_code` when you want a short result directly in chat
- use `format="overrides_only"` when only lines such as `OverrideNamedEngramEntries` matter
- use `beacon_export_project_file` when you explicitly want a local file
- use `beacon_export_project_smart` when you want the MCP to choose automatically between inline output and a `.txt` export

---

## Quick Start

After installation:

1. restart your MCP client
2. ask:

```text
Call beacon_auth_status
```

3. if needed, ask:

```text
Run beacon_login
```

4. finish the login at:

```text
https://usebeacon.app/device
```

5. then ask:

```text
Call beacon_login_check
```

6. then test:

```text
Call beacon_list_projects
```

---

## Available Tool Areas

### Authentication

- `beacon_login`
- `beacon_login_check`
- `beacon_auth_status`
- `beacon_logout`

### Projects and Configuration

- `beacon_list_projects`
- `beacon_find_project`
- `beacon_get_project`
- `beacon_create_project`
- `beacon_set_project_mod`
- `beacon_set_engram_unlock`
- `beacon_inspect_loot_project`
- `beacon_copy_loot_overrides`
- `beacon_copy_loot_family`
- `beacon_set_loot_override`
- `beacon_export_project_code`
- `beacon_export_project_file`
- `beacon_export_project_smart`
- `beacon_generate_game_ini`
- `beacon_put_game_ini`
- `beacon_generate_game_user_settings_ini`
- `beacon_put_game_user_settings_ini`
- `beacon_get_config_options`
- `beacon_list_command_line_options`

### Game Data

- `beacon_list_blueprints`
- `beacon_get_blueprint`
- `beacon_list_engrams`
- `beacon_get_engram`
- `beacon_list_creatures`
- `beacon_get_creature`
- `beacon_list_loot_drops`
- `beacon_list_spawn_points`
- `beacon_get_spawn_point`
- `beacon_list_maps`
- `beacon_list_game_variables`
- `beacon_search_mods`

### Sentinel

- `beacon_list_sentinel_services`
- `beacon_get_sentinel_service`
- `beacon_list_sentinel_groups`
- `beacon_get_sentinel_group`
- `beacon_list_sentinel_buckets`
- `beacon_get_sentinel_bucket`
- `beacon_list_sentinel_scripts`
- `beacon_get_sentinel_script`
- `beacon_list_players`
- `beacon_ban_player`
- `beacon_unban_player`
- `beacon_send_chat`
- `beacon_run_rcon`

### Connector

- `beacon_start_server`
- `beacon_stop_server`
- `beacon_get_server_status`
- `beacon_set_server_param`

---

## HTTP Mode

The project also exposes an HTTP mode:

```bash
npm run start:http
```

Main routes:

- `/health`
- `/openapi.json`
- `/tools/:toolName`
- `/mcp/sse`
- `/mcp/messages`

This is useful for:

- debugging
- API-style testing
- remote experiments

But it is not the primary user path.

---

## Authentication Model

Beacon authentication uses OAuth device flow.

Tokens are stored locally in:

```text
~/.beacon-mcp/tokens.json
```

No Beacon credentials are stored in the project directory.

---

## Installer Status

The `installer/` workspace now contains:

- app detection for Codex / Claude / Cursor
- config backup and patch logic
- runtime copy logic
- runtime startup checks
- Node.js prerequisite detection for `v1`
- a Node installer runner
- a first Inno Setup script
- user-selectable install targets in the Inno Setup groundwork

Current installer direction:

- `v1`: Node-based local installer flow
- `v2`: standalone `.exe` runtime

---

## Project Structure

Main runtime:

```text
src/
├── index.ts
├── registry.ts
├── api/
├── auth/
├── connector/
├── server/
└── tools/
```

Installer workspace:

```text
installer/
├── src/
│   ├── app-detection/
│   ├── config-patch/
│   ├── payload/
│   ├── post-install/
│   ├── types/
│   ├── uninstall/
│   ├── cli.ts
│   └── install.ts
├── build/
├── output/
└── README.md
```

---

## Development

Main MCP project:

```bash
npm run build
npm run dev
npm run dev:http
```

Installer workspace:

```bash
cd installer
npm run build
npm run detect
npm run install:run
node dist/cli.js --check-node
```

---

## Documentation

Useful docs:

- [Installation Guide](doc/ENG/MCP-INSTALLATION-GUIDE.md)
- [v1 Test Plan](doc/ENG/MCP-V1-TEST-PLAN.md)
- [V2 Action Plan](doc/ENG/MCP-V2-ACTION-PLAN.md)
- [Windows Installer MVP Plan](doc/ENG/MCP-WINDOWS-INSTALLER-MVP-PLAN.md)
- [Windows Installer Tech Design](doc/ENG/MCP-WINDOWS-INSTALLER-TECH-DESIGN.md)
- [`.exe` Runtime Transition Plan](doc/ENG/MCP-EXE-RUNTIME-TRANSITION-PLAN.md)
- [Codex Smoke Tests](doc/ENG/MCP-CODEX-SMOKE-TESTS.md)

French equivalents are available in `doc/FR`.

---

## Recommendation

If you are technical:

- use the terminal installation now
- validate the MCP and installer `v1`

If you are non-technical:

- wait for the Windows installer path to mature

The immediate next milestone for the project is not the standalone `.exe` yet.

It is:

- validating the current `v1`
- stabilizing the installer flow
- then moving to the standalone runtime
