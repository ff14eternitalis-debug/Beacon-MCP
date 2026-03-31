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

> Endpoints and structures validated against the Beacon source code (`C:\Users\forgo\Documents\Code\Projet-Beacon\Beacon`).

### Batch A — Projects & configs *(high priority)*

- [X] `beacon_list_projects()` — `GET /projects`
- [X] `beacon_get_project(projectId)` — `GET /projects/{id}`
- [X] `beacon_generate_game_ini(projectId, game, qualityScale?, difficultyValue?, mapMask?)` — `GET /{game}/projects/{id}/Game.ini`
- [X] `beacon_put_game_ini(projectId, game, content)` — `PUT /{game}/projects/{id}/Game.ini` (plain text)
- [X] `beacon_get_config_options(game, filter?)` — `GET /{game}/configOptions` (read-only, shows header/key/type/default/file)
- [X] `beacon_create_project(game, name, description?)` — builds the `application/x-beacon-project` binary (8-byte magic + TAR.GZ) client-side, fetches userId via `/users/me`, POST to `/projects`

### Batch B — Game data *(medium priority)*

- [X] `beacon_list_blueprints(game, filter?, contentPackId?)` — `GET /{game}/blueprints`
- [X] `beacon_list_engrams(game, filter?, contentPackId?)` — `GET /{game}/engrams`
- [X] `beacon_list_loot_drops(game)` — `GET /{game}/lootDrops`
- [X] `beacon_search_mods(game, query?)` — `GET /contentPacks?gameId=Ark|ArkSA`

### Batch C — Sentinel *(priority based on needs)*

- [X] `beacon_list_players(serviceId)` — `GET /sentinel/players?serviceId=`
- [X] `beacon_ban_player(serviceId, playerId, reason?, expiration?)` — `POST /sentinel/serviceBans/{uuid}` (UUID generated client-side)
- [X] `beacon_unban_player(serviceId, playerId)` — `GET /sentinel/serviceBans?expired=false` + `DELETE /sentinel/serviceBans/{id}`
- [X] `beacon_send_chat(serviceId, message, senderName?, languageCode?)` — `POST /sentinel/chat` (204 No Content)
- [X] `beacon_run_rcon(serviceId, type, command|message, senderName?)` — `POST /sentinel/gameCommands` (types: `admin`, `broadcast`, `chat`)

---

## Phase 4 — TCP Connector Client *(optional)*

**Goal:** Local server control (start / stop / status).

**Estimated time:** 1 day

> Done last — depends on access to a machine with Connector installed for testing.

### Steps

- [X] Implement the TCP socket to port `48962`
- [X] Handshake: receive + decrypt the connectionKey (AES + pre-shared key)
- [X] AES-256-CBC encryption with random IV (native `Node.js crypto`)
- [X] CRC32 (polynomial 0xEDB88320) on the plaintext payload
- [X] Incremental nonce management
- [X] Pre-shared key preparation: hex 64 chars → decode, otherwise → SHA-256
- [X] Tools:
  - [X] `beacon_start_server(host, key, port?)`
  - [X] `beacon_stop_server(host, key, port?, message?)`
  - [X] `beacon_get_server_status(host, key, port?)`
  - [X] `beacon_set_server_param(host, key, port?, param, value)`

> Protocol extracted from the Connector Xojo source code (ControlSocket, BeaconEncryption, SymmetricHeader).
> To be tested with a production Connector — endpoints verified against source code.

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
3. ✅ **Multi-account** — Single account at a time. Token stored in `~/.beacon-mcp/tokens.json`. Multi-account possible later via `beacon_switch_account` if needed.
4. ✅ **Priority games** — MVP: **ARK Survival Evolved** + **ARK Survival Ascended**. Palworld planned for a later phase.

---

*Document created on 2026-03-30 — Based on MCP-BRIDGE.md analysis*
