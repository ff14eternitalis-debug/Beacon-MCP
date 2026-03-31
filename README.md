# Beacon MCP

![Status](https://img.shields.io/badge/status-in%20development-yellow)
![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-20+-5FA04E?logo=node.js&logoColor=white)
![MCP SDK](https://img.shields.io/badge/MCP%20SDK-1.28-blueviolet?logo=anthropic&logoColor=white)
![License](https://img.shields.io/badge/license-ISC-blue)

A [Model Context Protocol](https://modelcontextprotocol.io) server that bridges AI assistants (Claude, Cursor) with the [Beacon](https://usebeacon.app) game server management platform.

> **Phases 1–4 complete.** Authentication, project management, game data, Sentinel integration, and the Connector TCP client are all implemented.

---

## What it does

Beacon MCP exposes Beacon's API as MCP tools, letting AI assistants manage game server configurations, blueprints, loot tables, players, bans, and live server control — directly from the chat interface.

```
Claude Desktop / Cursor  ──────  stdio (subprocess)  ──────▶  Beacon MCP  ──────▶  Beacon API v4
                                                                           ──────▶  Connector TCP
```

---

## Tech stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20+ |
| Language | TypeScript 6 |
| MCP protocol | `@modelcontextprotocol/sdk` 1.28 |
| HTTP client | Axios 1.x |
| Auth | OAuth 2.1 — device flow + PKCE (SHA-256) |
| API | Beacon API v4 — `https://api.usebeacon.app/v4` |
| Connector | TCP, AES-256-CBC, CRC32, custom binary protocol |
| Config | dotenv |

---

## Prerequisites

- Node.js 20 or later
- A [Beacon](https://usebeacon.app) account
- Claude Desktop, Cursor, or any MCP-compatible client

---

## Installation

```bash
git clone https://github.com/ff14eternitalis-debug/Beacon-MCP.git
cd Beacon-MCP
npm install
npm run build
```

---

## Usage

### Claude Desktop / Cursor (stdio)

Add the server to your client config. No `.env` needed — authentication is handled interactively via `beacon_login`.

**Claude Desktop** — `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "beacon": {
      "command": "node",
      "args": ["C:/path/to/Beacon-MCP/dist/index.js"]
    }
  }
}
```

**Cursor** — `~/.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "beacon": {
      "command": "node",
      "args": ["C:/path/to/Beacon-MCP/dist/index.js"]
    }
  }
}
```

---

## Authentication

Authentication uses **OAuth 2.1 with device flow** — no browser integration required.

```
1. Call beacon_login
   → Returns a short code and a URL

2. Open https://usebeacon.app/device in your browser
   → Sign in and enter the code

3. Call beacon_login_check
   → Tokens are saved to ~/.beacon-mcp/tokens.json
   → Access token is refreshed automatically when it expires
```

Tokens are stored locally in `~/.beacon-mcp/tokens.json`. No credentials are ever stored in the project directory.

---

## Available tools

### Authentication

| Tool | Description |
|---|---|
| `beacon_login` | Start device flow — returns a short code and URL |
| `beacon_login_check` | Poll until the user has authorized in the browser |
| `beacon_auth_status` | Check connection state, user ID, and token expiry |
| `beacon_logout` | Delete local tokens |

### Projects & configuration

| Tool | Description |
|---|---|
| `beacon_list_projects` | List all projects for the authenticated user |
| `beacon_get_project` | Get project metadata by ID |
| `beacon_create_project` | Create a new empty project (game: `ark` or `arksa`) |
| `beacon_generate_game_ini` | Generate and return the Game.ini for a project |
| `beacon_put_game_ini` | Upload a full Game.ini to a project |
| `beacon_get_config_options` | List all valid INI configuration keys for a game |

### Game data

| Tool | Description |
|---|---|
| `beacon_list_blueprints` | List blueprints (creatures, items, structures) with UE4 paths |
| `beacon_list_engrams` | List craftable engrams (items) |
| `beacon_list_loot_drops` | List loot drop containers (crates, beacons…) |
| `beacon_search_mods` | Search mods (content packs) indexed in Beacon |

### Sentinel — server & player management

| Tool | Description |
|---|---|
| `beacon_list_players` | List known players on a Sentinel service |
| `beacon_ban_player` | Ban a player (permanent or timed) |
| `beacon_unban_player` | Lift all active bans for a player |
| `beacon_send_chat` | Send a message to the in-game chat |
| `beacon_run_rcon` | Execute an RCON command or broadcast a message |

### Connector — local server control

> Requires the Beacon Connector daemon running on the target machine (port 48962).

| Tool | Description |
|---|---|
| `beacon_start_server` | Start the game server via Connector |
| `beacon_stop_server` | Stop the game server (with optional shutdown message) |
| `beacon_get_server_status` | Check whether the server is running or stopped |
| `beacon_set_server_param` | Update a server parameter live (no restart needed) |

---

## Configuration

Copy `.env.example` to `.env`. All variables are optional — the server works out of the box without any configuration.

```env
# Beacon API base URL (default: https://api.usebeacon.app/v4)
# BEACON_API_URL=https://api.usebeacon.app/v4

# OAuth client ID (default: official Beacon web app)
# BEACON_CLIENT_ID=12877547-7ad0-466f-a001-77815043c96b
```

---

## Project structure

```
src/
├── index.ts              Entry point — stdio MCP server
├── registry.ts           Central tool registry
├── auth/
│   ├── pkce.ts           PKCE utilities (code_verifier + SHA-256 challenge)
│   ├── tokens.ts         Token storage (~/.beacon-mcp/)
│   └── oauth.ts          Device flow, polling, token refresh
├── api/
│   └── client.ts         Axios client with automatic Bearer auth + refresh
├── connector/
│   └── client.ts         TCP client — AES-256-CBC + CRC32 + handshake
└── tools/
    ├── shared.ts          Shared utilities (textResult, formatApiError, …)
    ├── auth.ts            Authentication tools
    ├── projects.ts        Project & configuration tools
    ├── gamedata.ts        Game data tools (blueprints, engrams, mods)
    ├── sentinel.ts        Sentinel tools (players, bans, chat, RCON)
    └── connector.ts       Connector tools (start, stop, status, param)
```

---

## Development

```bash
# Build
npm run build

# Run in stdio mode (dev)
npm run dev
```

---

## Roadmap

- [x] Phase 1 — Project setup (MCP SDK, stdio transport, TypeScript)
- [x] Phase 2 — OAuth 2.1 authentication (device flow, PKCE, token refresh)
- [x] Phase 3 — REST tools (projects, Game.ini, blueprints, engrams, Sentinel)
- [x] Phase 4 — Connector TCP client (AES-256-CBC, CRC32, local server control)
- [ ] Phase 5 — Testing & refinement

---

## Related

- [Beacon](https://usebeacon.app) — Game server configuration platform
- [Beacon API v4 docs](https://help.usebeacon.app/api/v4/)
- [Model Context Protocol](https://modelcontextprotocol.io)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
