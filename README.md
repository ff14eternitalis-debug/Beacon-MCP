# Beacon MCP

![Status](https://img.shields.io/badge/status-active-green)
![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-20+-5FA04E?logo=node.js&logoColor=white)
![MCP SDK](https://img.shields.io/badge/MCP%20SDK-1.28-blueviolet)

`Beacon-MCP` is a local MCP server that connects AI assistants to [Beacon](https://usebeacon.app) so users can inspect data, create projects, edit common settings, and export useful config directly from Codex, Claude Desktop, or Cursor.

## What It Does

- local `stdio` MCP server for Codex, Claude Desktop, and Cursor
- Beacon OAuth device login
- project lookup by name
- guarded project edits for mods, engrams, and loot
- `Game.ini` and `GameUserSettings.ini` read/write
- direct export to chat or local `.txt` file
- Beacon game data browsing
- Sentinel and local Connector tooling
- Windows installer groundwork in `installer/`

Supported scope today:

- `ark`
- `arksa`
- partial support for `palworld`
- selected config support for `7dtd`

## Installation

Current recommended setup:

```bash
git clone https://github.com/ff14eternitalis-debug/Beacon-MCP.git
cd Beacon-MCP
npm install
npm run build
```

Configure your MCP client to launch:

```text
node C:\path\to\Beacon-MCP\dist\index.js
```

The Windows installer flow is in progress in [installer/README.md](C:/Users/forgo/Documents/Code/Projet-Beacon/Beacon-MCP/installer/README.md).

## Quick Start

1. Restart your MCP client.
2. Call `beacon_auth_status`.
3. If needed, call `beacon_login`.
4. Complete login in your browser.
5. Call `beacon_login_check`.
6. Test with `beacon_list_projects`.

## Common Workflows

Natural requests the MCP is designed to support:

- “Active Cybers Structures QoL+ dans mon projet X”
- “Mets la CS Tek Forge niveau 180 dans mon projet X”
- “Exporte le code de mon projet”
- “Inspecte mon projet loot Astraeos”

Important tools:

- `beacon_find_project`
- `beacon_find_engram`
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

Guardrails included:

- verifies project ownership and game match
- preserves existing mod selections and engram overrides
- creates local backups before writes
- reloads the project after writes to confirm the result

Local files used by the MCP:

- tokens: `~/.beacon-mcp/tokens.json`
- backups: `~/.beacon-mcp/backups/`
- exports: `~/.beacon-mcp/exports/`

## Development

Main project:

```bash
npm run build
npm run dev
npm run dev:http
npm run test:smoke
```

Installer workspace:

```bash
cd installer
npm run build
npm run detect
npm run install:run
```

## Documentation

English:

- [User Guide](C:/Users/forgo/Documents/Code/Projet-Beacon/Beacon-MCP/doc/ENG/MCP-USER-GUIDE.md)
- [Installation Guide](C:/Users/forgo/Documents/Code/Projet-Beacon/Beacon-MCP/doc/ENG/MCP-INSTALLATION-GUIDE.md)
- [V1 Test Plan](C:/Users/forgo/Documents/Code/Projet-Beacon/Beacon-MCP/doc/ENG/MCP-V1-TEST-PLAN.md)
- [V2 Action Plan](C:/Users/forgo/Documents/Code/Projet-Beacon/Beacon-MCP/doc/ENG/MCP-V2-ACTION-PLAN.md)

French:

- [Guide utilisateur](C:/Users/forgo/Documents/Code/Projet-Beacon/Beacon-MCP/doc/FR/MCP-USER-GUIDE.md)
- [Guide d'installation](C:/Users/forgo/Documents/Code/Projet-Beacon/Beacon-MCP/doc/FR/MCP-INSTALLATION-GUIDE.md)
- [Plan de test V1](C:/Users/forgo/Documents/Code/Projet-Beacon/Beacon-MCP/doc/FR/MCP-V1-TEST-PLAN.md)
- [Plan d'action V2](C:/Users/forgo/Documents/Code/Projet-Beacon/Beacon-MCP/doc/FR/MCP-V2-PLAN-ACTION.md)

## Status

The MCP is already usable locally. The current focus is:

- stabilizing project-editing workflows
- validating the installer `v1`
- preparing a smoother Windows distribution path
