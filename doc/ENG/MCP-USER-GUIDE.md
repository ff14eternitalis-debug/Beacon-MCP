# Beacon MCP — User Guide

> Practical guide for using `Beacon-MCP` in Codex, Claude Desktop, or Cursor without having to rely on the Beacon UI for common workflows.

---

## Goal

`Beacon-MCP` lets you use Beacon from a local AI assistant to:

- connect to Beacon
- find your projects
- create or modify a project
- enable mods
- change engrams
- inspect or copy loot structures
- export useful project code

The goal is simple:

- talk naturally to the assistant
- let the MCP handle Beacon lookups
- only open Beacon Desktop when it is genuinely needed

---

## Before You Start

To use this guide, you need:

- `Beacon-MCP` installed locally
- Codex, Claude Desktop, or Cursor configured with the Beacon MCP server
- a Beacon account
- Beacon Desktop installed if you also want to visually verify some projects

If that is not done yet:

- see [MCP-INSTALLATION-GUIDE.md](/C:/Users/forgo/Documents/Code/Projet-Beacon/Beacon-MCP/doc/ENG/MCP-INSTALLATION-GUIDE.md)

---

## First Startup

After installation:

1. restart your AI application
2. ask:

```text
Call beacon_auth_status
```

3. if you are not connected:

```text
Call beacon_login
```

4. complete the login in your browser
5. then ask:

```text
Call beacon_login_check
```

6. finally verify everything works:

```text
Call beacon_list_projects
```

---

## How To Talk To The MCP

You can use two styles.

### Simple style

Talk normally, for example:

```text
Create an ArkSA project to unlock Tek Forge at level 180.
```

```text
Enable the Cybers Structures QoL+ mod in my project test tek forge 180.
```

```text
Export the useful code from my project test tek forge 180.
```

### Direct style

Ask for an explicit tool call:

```text
Call beacon_find_project query="test tek forge" game="arksa"
```

```text
Call beacon_export_project_code projectName="test tek forge 180" game="arksa" format="overrides_only"
```

Both approaches are valid. For non-technical users, the simple style is usually the best one.

---

## Targeting A Project Without A UUID

You usually no longer need to know `projectId`.

The MCP can now:

- use `projectName`
- search by partial name with `beacon_find_project`
- ask for clarification if several projects look similar

Examples:

```text
Inspect my Astraeos loot project.
```

```text
Call beacon_find_project query="loot Astraeos" game="arksa"
```

If several close matches exist, the assistant should show them before writing anything.

---

## Most Useful Workflows

### 1. Create a project and enable a mod

Example natural request:

```text
Create an ArkSA project named test tek forge 180 for The Center, Scorched Earth, Ragnarok, Valguero, and Astraeos.
Then enable Cybers Structures QoL+.
```

What the assistant should do:

- confirm the game
- confirm the map or maps
- search the mod if needed
- create the project
- enable the right content pack
- re-read the project to confirm

---

### 2. Unlock an engram at a specific level

Example:

```text
In my project test tek forge 180, automatically unlock CS Tek Forge at level 180.
```

The MCP should then:

- find the project
- verify the game
- verify the engram
- verify the required mod is enabled, or propose it
- apply the engram override
- re-read the project

Expected useful export line:

```ini
OverrideNamedEngramEntries=(EngramClassName="EngramEntry_TekForge_CS_C",EngramLevelRequirement=180,EngramPointsCost=0)
```

---

### 3. Read or export project code

For a small result:

```text
Give me the useful line from my project test tek forge 180.
```

Or:

```text
Call beacon_export_project_code projectName="test tek forge 180" game="arksa" format="overrides_only"
```

For a large result:

```text
Export the full code of my project test tek forge 180 to a local file.
```

Or:

```text
Call beacon_export_project_file projectName="test tek forge 180" game="arksa" file="all"
```

To let the MCP choose:

```text
Call beacon_export_project_smart projectName="test tek forge 180" game="arksa" format="overrides_only"
```

Expected behavior:

- small output: direct reply in chat
- large output: automatic export in `~/.beacon-mcp/exports/`

---

### 4. Read or edit `Game.ini` directly

Read:

```text
Call beacon_generate_game_ini projectName="test tek forge 180" game="arksa"
```

Write:

```text
Call beacon_put_game_ini projectName="test tek forge 180" game="arksa" content="..."
```

Same logic for `GameUserSettings.ini`:

- `beacon_generate_game_user_settings_ini`
- `beacon_put_game_user_settings_ini`

---

### 5. Inspect a native Beacon loot project

Example:

```text
Inspect my project [ARCHIVE] LOOTS /// RILINDRA Loot Aérien Astraeos [EXTRAIT].
```

Or:

```text
Call beacon_inspect_loot_project projectName="[ARCHIVE] LOOTS /// RILINDRA Loot Aérien Astraeos [EXTRAIT]" game="arksa"
```

This tool is meant to summarize:

- override count
- reusable families
- sets
- item pools
- content packs in use

---

### 6. Copy a loot family from one project to another

Example:

```text
Copy the Astraeos Blue family from my Astraeos archive loot project into my project My Astraeos Loot Test.
```

Or:

```text
Call beacon_copy_loot_family sourceProjectName="[ARCHIVE] LOOTS /// RILINDRA Loot Aérien Astraeos [EXTRAIT]" targetProjectName="My Astraeos Loot Test" game="arksa" family="Astraeos Blue"
```

The MCP should:

- read the source project
- find the requested family
- merge required content packs into the target project
- save the target project
- re-read it after writing

---

## Important Guardrails

Current project writes in the MCP are meant to be cautious:

- verify the project belongs to the connected user
- verify the targeted game
- create a local `.beacon` backup before writing
- re-read after writing
- merge mods instead of replacing existing selections
- ask for clarification if a mod or project is ambiguous

Local backups:

```text
~/.beacon-mcp/backups/
```

Local exports:

```text
~/.beacon-mcp/exports/
```

---

## User Best Practices

- always mention the game when it matters: `Ark` or `ArkSA`
- use the most precise project name you can
- mention the map or maps when creating a project
- mention the mod name if an item depends on a content pack
- ask for confirmation before writing to a real production project

Examples of good requests:

```text
Create an ArkSA project named Boss Test for The Island and enable Cybers Structures QoL+.
```

```text
Inspect my Astraeos loot project and summarize the reusable crate families.
```

```text
Give me only the useful override lines from my project test tek forge 180.
```

---

## Current Limits

- some Sentinel operations require a configured Sentinel service
- very large projects may need file export instead of chat output
- some very specific Beacon workflows may still benefit from visual checking in Beacon Desktop
- the future `.exe` installer is not yet the main installation path

---

## Quick Troubleshooting

### The MCP is not responding

Check:

- that the AI app was restarted
- that the Beacon MCP server is configured correctly
- that the build exists if you are using terminal mode

### Beacon says you are not connected

Run:

```text
Call beacon_auth_status
Call beacon_login
Call beacon_login_check
```

### The MCP does not find the right project

Ask:

```text
Call beacon_find_project query="partial project name" game="arksa"
```

Then choose the correct name from the returned matches.

### There are several matching mods

The assistant should show the available choices and confirm the correct mod before writing.

---

## Summary

The best way to use `Beacon-MCP` today is:

- talk naturally to your assistant
- let the MCP find the right project
- confirm important write actions
- use direct chat export for small outputs
- use file export for large projects

If the project is configured correctly, you can already cover a large part of Beacon workflows without manually navigating Beacon Desktop.
