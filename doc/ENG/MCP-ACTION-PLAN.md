# Beacon MCP Bridge — Action Plan

> Roadmap for the creation of the MCP (Model Context Protocol) server connecting an AI to the Beacon application.

---

## Phase 1 — Project Setup

**Goal:** Have an empty MCP server running and responding to Claude Desktop.

**Estimated time:** ½ day

### Steps

- [X] Create the `beacon-mcp` repo (separate folder from the Beacon repo)
- [X] Initialize the Node.js project: `npm init -y`
- [X] Install dependencies:
  ```
  @modelcontextprotocol/sdk
  axios
  typescript
  ts-node
  @types/node
  dotenv
  ```
- [X] Create `tsconfig.json` + folder structure:
  ```
  src/
  ├── index.ts          ← MCP entry point (stdio transport)
  ├── auth/             ← OAuth2 device_code
  ├── api/              ← REST API wrappers
  ├── tools/            ← MCP tool definitions
  └── connector/        ← TCP client (Phase 4)
  ```
- [X] Test with Claude Desktop via `claude_desktop_config.json`

---

## Phase 2 — OAuth 2.1 Authentication (device flow)

**Goal:** Connect the user to Beacon via OAuth 2.1 device flow, without an integrated browser.

> API v4 (`https://api.usebeacon.app/v4`) — OAuth 2.1 + PKCE
> Official Beacon Client ID: `12877547-7ad0-466f-a001-77815043c96b` (public app, no secret)
> Tokens: access (~1h) + refresh (~30d), automatic renewal

**Estimated time:** ½ day

### Steps

- [X] `src/auth/pkce.ts` — code_verifier + code_challenge generation (SHA-256 Base64URL)
- [X] `src/auth/tokens.ts` — token storage in `~/.beacon-mcp/tokens.json` + pending flow
- [X] `src/auth/oauth.ts` — `startDeviceFlow()`, `pollDeviceFlow()`, `refreshAccessToken()`
- [X] `src/api/client.ts` — Axios Bearer token client + automatic refresh
- [X] `src/tools/auth.ts` — 4 MCP tools: `beacon_login`, `beacon_login_check`, `beacon_auth_status`, `beacon_logout`
- [X] `.env.example` — without credentials (auth via browser, tokens stored locally)
- [X] TypeScript compilation without errors

### User flow

```
1. "Connect me to Beacon"
   → beacon_login        : returns a short code + URL
   → User opens usebeacon.app/device in their browser

2. "Done, I authorized it"
   → beacon_login_check  : exchanges the code for tokens, saves them

3. Normal usage
   → All tools use the Bearer token automatically
   → Silent refresh when the access token expires
```

### No configuration required

Zero mandatory environment variables — auth is done interactively via `beacon_login`.

---

## Phase 3 — Essential REST Tools

**Goal:** Cover the 80% of common use cases.

**Estimated time:** 1 to 2 days

### Batch A — Projects & configs *(high priority)*

- [ ] `list_projects()`
- [ ] `get_project(projectId)`
- [ ] `create_project(game, name)`
- [ ] `generate_game_ini(projectId)`
- [ ] `get_config_options(game)`
- [ ] `update_config(projectId, options)`

### Batch B — Game data *(medium priority)*

- [ ] `list_blueprints(game, filter?)`
- [ ] `list_engrams(game, filter?)`
- [ ] `list_loot_drops(game)`
- [ ] `search_mods(game, query)`

### Batch C — Sentinel *(priority based on needs)*

- [ ] `list_players(serviceId)`
- [ ] `ban_player(serviceId, playerId)`
- [ ] `unban_player(serviceId, playerId)`
- [ ] `send_chat(serviceId, message)`
- [ ] `run_rcon(serviceId, command)`

---

## Phase 4 — TCP Connector Client *(optional)*

**Goal:** Local server control (start / stop / status).

**Estimated time:** 1 day

> To be done last — depends on access to a machine with Connector installed for testing.

### Steps

- [ ] Implement the TCP socket to port `48962`
- [ ] Handshake: send the 32-byte key
- [ ] AES-256-CBC encryption with random IV (native `Node.js crypto`)
- [ ] Incremental nonce management
- [ ] Tools:
  - [ ] `start_server(connectorConfig)`
  - [ ] `stop_server(connectorConfig, message?)`
  - [ ] `get_server_status(connectorConfig)`
  - [ ] `set_server_param(connectorConfig, key, value)`

---

## Phase 5 — Testing & Refinement *(ongoing)*

- [ ] Manually test each tool via Claude Desktop
- [ ] Write precise tool descriptions (the LLM reads them to choose)
- [ ] Handle API errors properly (`401`, `404`, rate limits)
- [ ] Document prerequisites (mod must be indexed, Sentinel token required, etc.)

---

## Priority Order

| Order | Phase                    | Value                   | Effort |
| ----- | ------------------------ | ----------------------- | ------ |
| 1     | Project setup + auth     | Foundation              | Easy   |
| 2     | Project/config tools     | Main use case           | Easy   |
| 3     | Blueprints/engrams tools | Loot & recipes          | Easy   |
| 4     | Sentinel tools           | Community management    | Medium |
| 5     | Connector client         | Local server control    | Medium |

---

## Open Questions

1. ✅ **MCP hosting** — **Local stdio**, launched as subprocess by Claude Desktop / Cursor.
   Beacon being a local app (.exe), no remote server is needed.
   ChatGPT is not MCP-compatible (different protocol — Actions/OpenAPI).
2. ✅ **API access** — Production URL: `https://api.usebeacon.app/v4` (API v4, current).
   Documentation: `https://help.usebeacon.app/api/v4/`
   No documented staging. The URL is configurable via `BEACON_API_URL` in `.env` to point to a local instance if needed.
3. **Multi-account** — Single account in `.env` or management of multiple accounts?
4. **Priority games** — Ark only for MVP, or multi-game from the start?

---

*Document created on 2026-03-30 — Based on MCP-BRIDGE.md analysis*
