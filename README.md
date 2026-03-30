# Beacon MCP

![Status](https://img.shields.io/badge/status-in%20development-yellow)
![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-20+-5FA04E?logo=node.js&logoColor=white)
![MCP SDK](https://img.shields.io/badge/MCP%20SDK-1.28-blueviolet?logo=anthropic&logoColor=white)
![Express](https://img.shields.io/badge/Express-5.x-000000?logo=express&logoColor=white)
![License](https://img.shields.io/badge/license-ISC-blue)

A [Model Context Protocol](https://modelcontextprotocol.io) server that bridges AI assistants (Claude, Cursor) with the [Beacon](https://usebeacon.app) game server management platform.

> **Work in progress** — Authentication is complete. REST tools, Sentinel integration, and the Connector TCP client are coming in upcoming phases.

---

## What it does

Beacon MCP exposes Beacon's API as MCP tools, letting AI assistants manage game server configurations, blueprints, loot tables, players, and more — directly from the chat interface.

```
Claude Desktop / Cursor  ──────  stdio (subprocess)  ──────▶  Beacon MCP  ──────▶  Beacon API v4
ChatGPT Actions          ──────  HTTP REST + OpenAPI  ──────▶  Beacon MCP  ──────▶  Beacon API v4
SSE-capable MCP clients  ──────  HTTP SSE             ──────▶  Beacon MCP  ──────▶  Beacon API v4
```

---

## Tech stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20+ |
| Language | TypeScript 6 |
| MCP protocol | `@modelcontextprotocol/sdk` 1.28 |
| HTTP server | Express 5 |
| HTTP client | Axios 1.x |
| Auth | OAuth 2.1 — device flow + PKCE (SHA-256) |
| API | Beacon API v4 — `https://api.usebeacon.app/v4` |
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

### ChatGPT Actions / SSE clients (HTTP mode)

```bash
# Optional: copy and configure .env
cp .env.example .env

# Start the HTTP server
npm run start:http
```

Expose it publicly (e.g. with [ngrok](https://ngrok.com)):
```bash
ngrok http 3333
```

Then in ChatGPT → *Explore GPTs* → *Create* → *Actions* → *Import from URL*:
```
https://your-ngrok-url.ngrok.io/openapi.json
```

Set authentication to **Bearer Token** and use the value of `MCP_API_KEY`.

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

Tokens are stored locally in `~/.beacon-mcp/tokens.json` with `0600` permissions. No credentials are ever stored in the project directory.

---

## Available tools

### Authentication

| Tool | Description |
|---|---|
| `beacon_login` | Start device flow — returns a code and URL |
| `beacon_login_check` | Poll for authorization completion |
| `beacon_auth_status` | Check connection state and token expiry |
| `beacon_logout` | Delete local tokens |

### Coming soon

| Tool | Phase |
|---|---|
| `list_projects`, `get_project`, `create_project` | Phase 3 |
| `generate_game_ini`, `update_config`, `get_config_options` | Phase 3 |
| `list_blueprints`, `list_engrams`, `list_loot_drops` | Phase 3 |
| `list_players`, `ban_player`, `send_chat`, `run_rcon` | Phase 3 |
| `start_server`, `stop_server`, `get_server_status` | Phase 4 |

---

## Configuration

Copy `.env.example` to `.env`. All variables are optional.

```env
# Beacon API base URL (default: https://api.usebeacon.app/v4)
# BEACON_API_URL=https://api.usebeacon.app/v4

# OAuth client ID (default: official Beacon web app)
# BEACON_CLIENT_ID=12877547-7ad0-466f-a001-77815043c96b

# HTTP server port (default: 3333)
# PORT=3333

# API key to protect HTTP endpoints (recommended when exposed publicly)
# Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# MCP_API_KEY=
```

---

## Project structure

```
src/
├── index.ts          Entry point — stdio or HTTP mode (--http flag)
├── registry.ts       Central tool registry shared by both transports
├── auth/
│   ├── pkce.ts       PKCE utilities (code_verifier + SHA-256 challenge)
│   ├── tokens.ts     Token storage (~/.beacon-mcp/)
│   └── oauth.ts      Device flow, polling, token refresh
├── api/
│   └── client.ts     Axios client with automatic Bearer auth + refresh
├── tools/
│   └── auth.ts       Auth tools (login, check, status, logout)
└── server/
    └── http.ts       Express HTTP server — REST endpoints + SSE MCP
```

---

## Development

```bash
# Run in stdio mode (dev)
npm run dev

# Run in HTTP mode (dev)
npm run dev:http

# Build
npm run build
```

---

## Roadmap

- [x] Phase 1 — Project setup (MCP SDK, stdio transport, TypeScript)
- [x] Phase 2 — OAuth 2.1 authentication (device flow, token refresh)
- [ ] Phase 3 — REST tools (projects, configs, blueprints, Sentinel)
- [ ] Phase 4 — Connector TCP client (local server control, AES-256-CBC)
- [ ] Phase 5 — Testing & refinement

---

## Related

- [Beacon](https://usebeacon.app) — Game server configuration platform
- [Beacon API v4 docs](https://help.usebeacon.app/api/v4/)
- [Model Context Protocol](https://modelcontextprotocol.io)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
