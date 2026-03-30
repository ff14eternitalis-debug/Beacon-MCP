# Beacon MCP Bridge — Feasibility Analysis

> Analysis document for the creation of an MCP (Model Context Protocol) server acting as a bridge between an AI (e.g. Claude) and the Beacon application.

---

## What is an MCP?

The **Model Context Protocol (MCP)** is an open protocol developed by Anthropic that allows an AI model to connect to external tools and data sources via structured "tools". An MCP server exposes functions that the AI can call, just like it would call an API.

---

## Available entry points in Beacon

Beacon exposes **three usable interfaces** for an MCP server.

---

### 1. The REST API (v4) — Main entry point

The REST API is the richest and best-documented path. It is accessible via `Website/api/v4/` and covers all Beacon features.

#### Authentication
- OAuth2 with `authorization_code`, `device_code`, `refresh_token` flows
- The `device_code` flow is ideal for an MCP (no browser interface required)
- Endpoint: `POST /login`

#### Available endpoint categories

| Category | Endpoints | Description |
|----------|-----------|-------------|
| **Projects** | `GET/POST/DELETE /projects` | List, create, delete server projects |
| **Configs** | `GET/PUT /ark/projects/{id}/Game.ini` | Generate/modify INI files |
| **Blueprints** | `ark/blueprints`, `arksa/blueprints` | CRUD on game blueprints |
| **Creatures** | `ark/creatures`, `arksa/creatures` | Creature data |
| **Engrams** | `ark/engrams` | Craftable items |
| **Loot** | `ark/lootDrops` | Loot containers |
| **Spawn Points** | `ark/spawnPoints` | Spawn points |
| **Variables** | `ark/gameVariables`, `ark/configOptions` | Game parameters |
| **Sentinel — Players** | `sentinel/players`, `sentinel/characters` | Player registry |
| **Sentinel — Commands** | `POST sentinel/gameCommands` | RCON execution |
| **Sentinel — Chat** | `POST sentinel/chat` | In-game chat |
| **Sentinel — Bans** | `sentinel/services/{id}/bans.txt` | Ban management |
| **Mods** | Content Packs via CurseForge/Steam | Access to mod catalogue |
| **Tokens** | `GET/POST/DELETE /tokens` | Service token management |

> The same endpoints exist for each supported game: `ark/`, `arksa/`, `palworld/`, `sdtd/`

---

### 2. The Connector (local daemon) — Server control

The Connector is a Xojo daemon application running on the machine hosting the game server. It exposes an encrypted TCP protocol.

#### Communication protocol

```
[MCP Client]
    ↓ TCP (port 48962 by default)
[Beacon Connector]
    1. Handshake: send a 32-byte connection key (AES-256)
    2. Exchange of JSON messages encrypted with sequential nonce
    3. CRC32 for integrity of each message
```

#### Encryption scheme
- **Version 2** (default): AES-256-CBC with random IV
- **Version 1** (legacy): Blowfish-CBC
- Pre-shared key stored in `config.json`
- Incremental nonce to prevent replay attacks

#### Configuration (`config.json`)

```json
{
  "Encryption Key": "<hex string 32 bytes>",
  "Port": 48962,
  "Config Folder": "/path/to/configs",
  "Logs Folder": "/path/to/logs",
  "Start Command": "start command",
  "Stop Command": "stop command (%message% substitution)",
  "Status Command": "status command",
  "Set Parameter Command": "key=%key% value=%value%"
}
```

#### Supported operations
- Start / stop the server
- Check server status
- Modify configuration parameters live
- Access to logs

---

### 3. Local files — Direct access (offline mode)

For cases without a cloud connection, it is possible to interact directly with local files.

| Format | Description |
|--------|-------------|
| `.beacon` | Project file (binary or gzip + serialized JSON) |
| `Game.ini` | Main Ark/ArkSA/Palworld config |
| `GameUserSettings.ini` | Server user config |
| `PalWorldSettings.ini` | Palworld-specific config |
| SQLite (local cache) | Cached blueprint and content pack data |

---

## Recommended MCP Tools

Here are the tools the MCP server could expose to an AI:

```
Project management:
├── list_projects()                        → list user's projects
├── get_project(projectId)                 → read a project's full config
├── create_project(game, name)             → create a new project
└── update_config(projectId, options)      → modify parameters

Game data:
├── list_blueprints(game, filter?)         → search creatures/items
├── get_blueprint(game, blueprintId)       → blueprint detail
├── list_engrams(game, filter?)            → craftable items
├── list_loot_drops(game, filter?)         → loot containers
└── search_mods(game, query)              → search mods

Config generation:
├── generate_game_ini(projectId, game)     → produce the final Game.ini
└── get_config_options(game)              → list all available parameters

Sentinel — Community:
├── list_players(serviceId)               → connected/known players
├── get_player(serviceId, playerId)        → player detail
├── ban_player(serviceId, playerId)        → ban a player
├── unban_player(serviceId, playerId)      → lift a ban
├── list_characters(serviceId)            → in-game characters
└── send_chat(serviceId, message)         → send an in-game message

Sentinel — Server commands:
├── run_rcon(serviceId, command)           → execute an RCON command
└── manage_scripts(serviceId)             → manage automation scripts

Connector — Local control:
├── start_server(connectorConfig)          → start the server
├── stop_server(connectorConfig, message?) → stop the server
├── get_server_status(connectorConfig)     → server status
└── set_server_param(connectorConfig, key, value) → modify a live param
```

---

## Recommended Architecture

```
┌─────────────────────┐
│   Claude / AI       │
│  (or any MCP LLM)   │
└────────┬────────────┘
         │ MCP Protocol (stdio or SSE)
         ▼
┌─────────────────────────────────┐
│       MCP Server                │
│   (Node.js + TypeScript)        │
│   SDK: @modelcontextprotocol    │
└──────────┬──────────────────────┘
           │                    │
    HTTP REST (OAuth2)     Encrypted TCP (AES-256)
           │                    │
           ▼                    ▼
┌──────────────────┐   ┌─────────────────────┐
│  Beacon Cloud    │   │  Beacon Connector   │
│  API v4          │   │  (local daemon)     │
└──────────┬───────┘   └──────────┬──────────┘
           │                      │
           ▼                      ▼
┌──────────────────┐   ┌─────────────────────┐
│  PostgreSQL      │   │  Game server        │
│  (Cloud)         │   │  (local)            │
└──────────────────┘   └─────────────────────┘
```

---

## Recommended Tech Stack

| Component | Technology | Justification |
|-----------|------------|---------------|
| MCP Server | **Node.js + TypeScript** | Official Anthropic MCP SDK available |
| OAuth2 Auth | `device_code` flow | No browser interface, ideal for MCP |
| HTTP Client | `axios` or native `fetch` | Calls to Beacon REST API |
| Connector client | Custom TCP socket | AES-256-CBC implementation (Node.js `crypto`) |
| Config | `.env` or `config.json` file | API keys, URL, Connector key |

---

## Complexity Estimate

| Component | Difficulty | Notes |
|-----------|------------|-------|
| REST API wrapper | **Easy** | Well-structured API, standard OAuth2 |
| Project/config CRUD tools | **Easy** | Clear and documented endpoints |
| INI config generation | **Easy** | Dedicated endpoint exists |
| Sentinel (players/RCON) | **Medium** | Requires valid Sentinel token |
| Local Connector (TCP) | **Medium** | Custom protocol to implement (AES encryption) |
| Full OAuth2 auth | **Medium** | `device_code` flow available, well-supported |
| Multi-game support | **Easy** | Same structure for Ark, ArkSA, Palworld, SDTD |

---

## Concrete Use Cases

With this MCP, an AI could:

- *"Optimize the spawn points on my Ark server to increase difficulty"*
- *"Generate a balanced Game.ini for 10 players in PvP"*
- *"List connected players and check for active bans"*
- *"Add this CurseForge mod to my project and regenerate the config"*
- *"Restart the server with the message 'Maintenance in 5 min'"*
- *"What engrams are available in this content pack?"*

---

## Data Quality: Can the AI trust Beacon?

> This question was raised by Beacon's creator: *"The AI will need a lot of Ark-specific training data in RAG. AI tends to interpret configurations very incorrectly."*

### What Beacon already provides

The API exposes for each configuration option:

```
description    → explanatory text of the option (present)
value_type     → Numeric / Boolean / Array / Structure / Text
default_value  → official default value
file           → Game.ini or GameUserSettings.ini
header         → exact INI section
ui_group       → semantic category
constraints    → JSON constraints object (field present in the schema)
```

The **syntactic structure is complete**: the AI knows *where* to put what, in what format, and has a textual description for each parameter.

---

### What is actually missing

The Beacon schema does not contain:

| Missing data | Consequence for the AI |
|--------------|------------------------|
| Recommended value ranges | May propose `XPMultiplier=500` without knowing it's absurd |
| Inter-parameter dependencies | e.g.: high XP + fast taming breaks progression |
| Server performance thresholds | Some values cause crashes |
| PvP vs PvE context | "Good" values are radically different depending on the mode |
| Creature stat ranges | No indication of what is considered "abusive" |

The `constraints` field exists in the PostgreSQL schema but is **nearly empty** in current data.

---

### Three approaches to solve the problem

#### Option A — Well-designed MCP (sufficient for 80% of cases)

The AI calls `get_config_options()` **before any modification**. It receives descriptions, types and default values. Modern LLMs have already been trained on massive Ark data (wikis, forums, Reddit, dedicated servers) and can reason correctly in this context.

- **Advantage:** Nothing more to build, operational immediately
- **Limitation:** The AI may still propose unbalanced values in rare cases

#### Option B — Enrich constraints in Beacon (recommended approach)

The `constraints` field already exists. It just needs to be progressively populated:

```json
{
  "min": 0.1,
  "max": 10.0,
  "recommended_min": 0.5,
  "recommended_max": 3.0,
  "warning": "Above 5.0, critical impact on server performance"
}
```

The MCP exposes these enriched constraints → the AI uses them as guardrails.

- **Advantage:** Data verified by Beacon developers, reusable in the UI as well
- **Effort:** Moderate — progressive enrichment of existing data

#### Option C — Dedicated RAG (what the creator proposes)

Ingest Ark docs (wiki, patch notes, community guides) into a vector database (pgvector, Pinecone) for on-the-fly contextual retrieval.

- **Advantage:** Very rich, covers rare cases and complex interactions
- **Disadvantage:** Infrastructure cost, ongoing maintenance, risk of stale data (Ark receives frequent updates)

---

### Verdict

> **The creator is right about the risk. He is wrong about the mandatory solution.**

| Approach | Effort | Coverage | Recommended for |
|----------|--------|----------|----------------|
| A — MCP alone | None | 80% of cases | Launch, MVP |
| B — Enriched constraints | Moderate | 95% of cases | Production |
| C — Dedicated RAG | High | 99% of cases | Complex strategies |

The real protection against bad configs remains that **the Beacon API itself validates inputs**: the AI proposes, Beacon refuses if syntactically invalid. Progressive constraint enrichment (Option B) is the best investment because it benefits both the MCP and Beacon's existing user interface.

---

## Custom Loot and Recipes with Modded Content

### The fundamental problem: mod blueprints

Everything in Beacon (loot, recipes) is referenced by an exact **UE4 blueprint path**:

```
Vanilla: /Game/PrimalEarth/Blueprints/Items/Armor/Helmet_Riot_C
Modded:  /Game/Mods/12345678/Blueprints/MyItem_C
```

The AI cannot invent these paths. A single wrong letter = item not found by the game. It must retrieve them from the Beacon database.

---

### Prerequisite: the mod must be indexed in Beacon

First and foremost, the mod must exist in `public.content_packs` with its items registered in `ark.engrams`. If the mod is not indexed, the AI has no way to know its items' paths.

```
GET /api/v4/ark/blueprints?contentPackId={mod_uuid}
→ returns all indexed items of the mod with their paths
```

If the result is empty → the mod is not yet in Beacon → import via Beacon UI first.

---

### The loot hierarchy (4-level structure)

The AI must understand and build this complete hierarchy:

```
LootSource   (the container: crate, beacon, chest...)
  └── ItemSet     (thematic group, e.g.: "Armor")
        └── Entry     (a "slot" with quality/quantity range)
              └── Option  (possible items in this slot, with weights)
                    └── Engram UUID  (the actual item, referenced by internal ID)
```

Each level has its own probabilistic parameters (weights, min/max, blueprint chance).

#### Key parameters per level

| Level | Important parameters |
|-------|----------------------|
| **LootSource** | `minItemSets`, `maxItemSets`, `preventDuplicates`, `multiplierMin/Max` |
| **ItemSet** | `minEntries`, `maxEntries`, `weight`, `preventDuplicates` |
| **Entry** | `minQuantity`, `maxQuantity`, `minQuality`, `maxQuality`, `blueprintChance`, `weight`, `statClampMultiplier` |
| **Option** | `engramId` (UUID), `weight` |

**Available quality tiers:** `Primitive → Ramshackle → Apprentice → Journeyman → Mastercraft → Ascendant → Tek`

---

### What the AI needs as context

#### To create custom loot with modded content

| Required data | API source | Available |
|---------------|------------|-----------|
| UUID of the mod's content pack | `GET /ark/blueprints?marketplace_id=STEAMID` | Yes, if indexed |
| List of mod engrams (label + uuid) | `GET /ark/engrams?contentPackId=UUID` | Yes, if indexed |
| List of existing loot sources | `GET /ark/lootDrops` | Yes |
| Quality tiers | Fixed enum in the schema | Yes |

#### To modify a craft recipe with modded items

| Required data | API source | Available |
|---------------|------------|-----------|
| UUID of the engram to modify | `GET /ark/engrams?label=ItemName` | Yes |
| UUID of each ingredient (vanilla or modded) | `GET /ark/engrams?contentPackId=UUID` | Yes, if indexed |
| Current recipe | `GET /ark/engrams/{id}` → `recipe` field | Yes |

---

### What is still missing (the real gap)

This information is **not in Beacon** and the AI will have to rely on its general Ark knowledge:

- Compatibility between mods (path conflicts)
- Balance of probability weights (e.g.: 1.0 vs 3.0 = how many % actually?)
- Quality rules by item type (armor vs weapon vs resource)
- Which loot sources are "safe" to modify vs sensitive vanilla ones
- Gameplay impact of a high `blueprintChance`
- Mods not yet indexed in Beacon

---

### Reliable workflow for the AI

```
1. Verify the mod is indexed
   → GET /ark/blueprints?marketplace_id=STEAMID
   → If empty: import the mod via Beacon UI first

2. Retrieve mod items
   → GET /ark/engrams?contentPackId={uuid}
   → The AI works with validated UUIDs, never with raw paths

3. Build the hierarchical JSON structure
   → LootSource → ItemSets → Entries → Options (engram UUIDs)

4. Submit via the API, Beacon validates
   → If a UUID is invalid, the API refuses automatically
```

> **Key point:** the AI never manipulates raw blueprint paths — it works exclusively with UUIDs already validated in the Beacon database. The risk of error is concentrated on one single question: **is the mod properly indexed?**

---

## Suggested Next Steps

1. **Initialize the MCP project** — `npm init` + SDK `@modelcontextprotocol/sdk`
2. **Implement OAuth2 auth** — `device_code` flow to `POST /login`
3. **Wrap priority REST endpoints** — projects, configs, blueprints
4. **Add Sentinel tools** — players, RCON, bans
5. **Implement the Connector client** (optional) — TCP socket + AES-256
6. **Test with Claude Desktop** — via `claude_desktop_config.json`

---

*Document generated on 2026-03-29 — Based on analysis of Beacon source code (branch `master`, commit `9bde11585`)*
