# Beacon MCP — V2 Action Plan

> A concrete action plan to evolve Beacon-MCP from a functional base into a more complete, more reliable, and more useful version for an AI agent.

---

## Goal

V2 should not try to expose all of Beacon at once.

The goal is to:

- stabilize the MCP server foundations;
- improve usability for an AI agent;
- cover the most useful project, config, and Sentinel use cases;
- prepare a clean extension path toward other business objects and other games.

---

## Current State

The existing base already covers:

- OAuth device flow authentication;
- Beacon project management;
- `Game.ini` read/write support;
- configuration option lookup;
- blueprint, engram, loot drop, and mod search;
- basic Sentinel actions;
- local control through the TCP Connector.

V2 now needs to reduce the gap between:

- what Beacon actually exposes through its API and data model;
- what Beacon-MCP currently lets an AI do cleanly.

---

## Design Principles

- Prioritize real workflows rather than raw endpoint exposure.
- Keep tools simple enough for an LLM to understand.
- Return outputs that are both human-readable and structured for the agent.
- Clearly separate domains: auth, projects, config, gamedata, sentinel, connector.
- Avoid overly generic tools that would become ambiguous for the model.

---

## V2 Priorities

### Priority 1 — Stabilize the Foundation

Goal: make the MCP more reliable and predictable.

Status: `Completed`

Recommended work:

- standardize tool response formats;
- keep a concise text field, but add a coherent structured payload;
- normalize auth, API, Sentinel, and Connector errors;
- clarify tool descriptions to improve LLM tool selection;
- add a shared argument validation convention.

Deliverables:

- enriched shared helpers in `src/tools/shared.ts`;
- a documented standard output format;
- normalized error messages.

Completed:

- unified output format with `ok / message / data / error / meta` structure;
- shared argument validation;
- centralized API error mapping;
- HTTP transport aligned with the structured format;
- migration of existing tools onto this foundation.

---

### Priority 2 — Complete Configuration Management

Goal: cover the most common server configuration needs.

Status: `Completed`

Recommended work:

- add `GameUserSettings.ini` read support;
- add `GameUserSettings.ini` write support;
- then review `CommandLineOption` and `CommandLineFlag` if the API exposes them cleanly;
- provide read-before-write tools to guide the AI through a safe workflow.

Target tools:

- `beacon_generate_game_user_settings_ini`
- `beacon_put_game_user_settings_ini`
- `beacon_list_command_line_options`
- `beacon_put_command_line_options`

Why this priority:

- it is a natural complement to `Game.ini`;
- it is immediately useful;
- the functional gain is high for a reasonable effort.

Completed:

- `beacon_generate_game_user_settings_ini`
- `beacon_put_game_user_settings_ini`
- `beacon_list_command_line_options`
- harmonized read -> modify -> write workflow with `Game.ini`
- cross-checking Beacon docs and code to confirm the real API surface

Remaining:

- if Beacon later exposes a dedicated project route for command-line output, add the matching write tools.

Technical conclusion:

- `GameUserSettings.ini` has a dedicated project route in API v4;
- `CommandLineFlag` and `CommandLineOption` do exist in the Beacon data model;
- however, the local API v4 router does not show a dedicated `.../CommandLine` project route, so V2 currently exposes that area in read-only mode through `configOptions`, without inventing an unproven write endpoint.

---

### Priority 3 — Extend Useful Game Data

Goal: let the AI reason with more business context.

Status: `Completed`

Recommended work:

- add creatures;
- add spawn points;
- add maps;
- add game variables;
- add single-item detail tools where a simple listing is not enough.

Target tools:

- `beacon_list_creatures`
- `beacon_get_creature`
- `beacon_list_spawn_points`
- `beacon_get_spawn_point`
- `beacon_list_maps`
- `beacon_list_game_variables`
- `beacon_get_blueprint`
- `beacon_get_engram`

Why this priority:

- these objects already exist in Beacon's structure;
- they are useful for balancing, diagnostics, and config generation;
- they reduce AI hallucinations by providing exact references.

Completed:

- `beacon_get_blueprint`
- `beacon_get_engram`
- `beacon_list_creatures`
- `beacon_get_creature`
- `beacon_list_spawn_points`
- `beacon_get_spawn_point`
- `beacon_list_maps`
- `beacon_list_game_variables`

Notes:

- routes were confirmed from the local Beacon API v4 router;
- detail tools rely on `GET /{game}/.../{id}` instance endpoints;
- existing `blueprints`, `engrams`, `lootDrops`, and `mods` listing tools were kept and harmonized in the same file.

---

### Priority 4 — Build a Real Sentinel V2

Goal: move from isolated actions to real visibility into the Sentinel ecosystem.

Status: `Completed`

Recommended work:

- list accessible Sentinel services;
- read service details;
- expose groups;
- expose buckets;
- expose scripts;
- then add characters, dinos, notes, or logs depending on needs.

Target tools:

- `beacon_list_sentinel_services`
- `beacon_get_sentinel_service`
- `beacon_list_sentinel_groups`
- `beacon_get_sentinel_group`
- `beacon_list_sentinel_buckets`
- `beacon_get_sentinel_bucket`
- `beacon_list_sentinel_scripts`
- `beacon_get_sentinel_script`

Why this priority:

- today the MCP can act on Sentinel, but it still describes it poorly;
- an agent needs discovery before action;
- this is a high-value product area.

Completed:

- `beacon_list_sentinel_services`
- `beacon_get_sentinel_service`
- `beacon_list_sentinel_groups`
- `beacon_get_sentinel_group`
- `beacon_list_sentinel_buckets`
- `beacon_get_sentinel_bucket`
- `beacon_list_sentinel_scripts`
- `beacon_get_sentinel_script`
- preserved existing action tools (`players`, `ban`, `unban`, `chat`, `rcon`)
- aligned Sentinel outputs with the same structured foundation as the rest of the MCP

Notes:

- endpoints were confirmed in the local Beacon API v4 router (`services`, `groups`, `buckets`, `scripts`);
- Sentinel listings now support discovery before action, with filters aligned to the search fields exposed by Beacon classes;
- detail tools rely on `GET /sentinel/.../{id}` instance endpoints to expose full metadata.

---

### Priority 5 — Prepare Multi-Game Expansion

Goal: move beyond the strict Ark/ArkSA scope without degrading MCP quality.

Status: `Completed`

Recommended work:

- generalize supported game validation;
- identify the truly stable endpoints for Palworld;
- introduce Palworld support in read-only mode first;
- keep SDTD for a later phase if use cases remain secondary.

Recommended order:

1. Palworld read-only
2. Palworld config
3. SDTD read-only

Completed:

- expanded the shared foundation to `palworld` and `7dtd`
- made supported game validation configurable per tool instead of relying on one implicit global enum
- added `palworld` support to `beacon_get_config_options`
- added `7dtd` support to `beacon_get_config_options`
- added `palworld` support to `beacon_list_game_variables`
- kept project and INI generation tools limited to `ark` / `arksa`, since these are the only confirmed project routes in the local API v4 surface

Notes:

- the local API v4 exposes `palworld/configOptions`, `palworld/gameVariables`, and `7dtd/configOptions`;
- no project route equivalent to `.../projects/{id}/Game.ini` was confirmed for `palworld` or `7dtd` in the local router;
- V2 multi-game expansion therefore remains intentionally conservative: discovery and read support first, project workflows later if Beacon officially extends that surface.

---

## Workflow-Oriented Approach

V2 should introduce a few task-oriented tools, not just endpoint wrappers.

Examples:

- `beacon_inspect_project_config`
- `beacon_prepare_config_change`
- `beacon_validate_config_change`
- `beacon_summarize_sentinel_service`

These tools can:

- aggregate several internal calls;
- reduce reasoning load on the LLM side;
- make results more reliable;
- better reflect real Beacon usage.

---

## Implementation Breakdown

### Batch 1 — Foundations

- refactor `shared.ts`
- standard response format
- error normalization
- tool description review

### Batch 2 — Advanced Config

- `GameUserSettings.ini`
- command-line options
- manual tests for read -> modify -> write workflows

### Batch 3 — Enriched Gamedata

- creatures
- spawn points
- maps
- game variables
- detail tools

### Batch 4 — Sentinel Discovery

- services
- groups
- buckets
- scripts

### Batch 5 — Multi-Game Expansion

- Palworld
- game enum harmonization
- compatibility review for existing tools

---

## Success Criteria

V2 is successful if:

- an agent can discover available objects before acting;
- MCP responses are more structured and stable;
- errors are understandable and actionable;
- config coverage is no longer limited to `Game.ini`;
- Sentinel becomes explorable, not just controllable;
- the architecture remains easy to extend.

---

## Risks to Watch

- adding too many tools too quickly and losing clarity;
- mixing text output and data without a stable convention;
- exposing write operations without a read/validation workflow;
- adding Palworld too early while the Ark/ArkSA foundation is not fully stabilized;
- building very low-level wrappers where a business-level tool would be more useful.

---

## Final Recommendation

The most cost-effective order for what comes next is:

1. stabilize outputs and errors;
2. add `GameUserSettings.ini`;
3. add `sentinel_list_services` and Sentinel discovery;
4. enrich game business objects;
5. open Palworld.

If only one step should be launched immediately, the best next batch is:

- `GameUserSettings.ini`
- `beacon_list_sentinel_services`
- response standardization

This trio delivers the best ratio of effort, usefulness, and user experience quality for an AI agent.
