# Connecting an AI to Beacon — Simple Explanation

> This document explains, without technical jargon, how an artificial intelligence could be connected to Beacon to help you manage your game server.

---

## What's the idea in a nutshell?

Imagine you could write to an AI (like ChatGPT or Claude):

> *"Create custom loot for my Ark server with items from the Primal Fear mod"*

...and the AI does it directly in Beacon, without you having to touch anything.

That's exactly what this bridge between AI and Beacon would enable.

---

## How would it work in practice?

Think of it as a **translator** between you, the AI, and Beacon.

```
You  →  you talk to the AI in plain English
 ↓
The AI  →  it understands what you want to do
 ↓
The bridge  →  it translates that into actions in Beacon
 ↓
Beacon  →  it applies the changes to your server
```

You never need to understand how Beacon works internally. You talk, the AI takes care of the rest.

---

## What the AI could do for you

### Manage your server
- Start or stop the server remotely
- Check if the server is running
- Change a config parameter without opening Beacon

### Customize the game
- Create custom loot in crates, chests and supply drops
- Modify an item's craft recipe
- Add mod items to existing loot
- Generate a complete configuration file based on your needs

### Manage the community
- See who is connected to the server
- Ban or unban a player
- Send a message in the game chat
- Manage automation scripts

---

## How can the AI enter Beacon?

There are **three possible entry points**:

### Entry 1 — Via the Beacon website (the main one)
Beacon already has a website with all available functions. The AI can log in with your account and do exactly what you would do manually. This is the most complete entry point.

### Entry 2 — Via the Connector (for the local server)
The Connector is a small program running on the machine hosting the server. It allows the AI to start/stop the server and modify settings in real time, even without going through the internet.

### Entry 3 — Via files (offline mode)
If everything else is unavailable, the AI can read and write the server configuration files directly on disk.

---

## Is the AI smart enough to do this correctly?

This is **the real question**, and Beacon's creator worries about it too. Here is the honest answer.

### What Beacon already gives the AI

For each configuration parameter, Beacon already knows:
- What the parameter does (a text description)
- What type of value it expects (a number, text, true/false...)
- What its default value is
- Which file it belongs to

That's already enough for the AI not to make basic mistakes.

### What Beacon doesn't know yet

Beacon doesn't (yet) have information on:
- Values that are "reasonable" vs "abusive" (e.g.: an XP multiplier at 500 is ridiculous)
- Parameters that interact with each other (e.g.: fast XP + fast taming = broken progression)
- The difference between a PvP setting and a PvE setting
- Values that crash the server if set too high

### Three ways to fill this gap

**Option 1 — Let the AI manage with what it knows**
Modern AIs have already been trained on tons of Ark data (wikis, forums, guides). In 80% of cases, they handle it correctly. This is the simplest solution to get started.

**Option 2 — Progressively enrich Beacon (recommended)**
Beacon already has slots designed to store recommended values, but they are empty. They just need to be progressively filled with indications like *"between 0.5 and 3.0 is reasonable, beyond that the server may have issues"*. The AI would use this info as guardrails.

**Option 3 — Create a dedicated documentation library (what the creator proposes)**
Gather all Ark guides, wikis and notes into a database that the AI consults before answering. This is the most robust solution but also the heaviest to maintain, as Ark updates frequently.

### In summary

> The AI can get balance values wrong, but it cannot create corrupted data — Beacon checks everything before applying. The worst that can happen is an unbalanced server, not a broken one.

---

## The special case of mods

This is where things get a bit more complex. Here's why.

### Each mod item has a unique address

In Ark, every object (whether vanilla or modded) has a precise address in the game files, much like a folder path on your computer. For example:

```
Vanilla item  :  /Game/PrimalEarth/Blueprints/Items/Armor/Helmet_Riot_C
Modded item   :  /Game/Mods/12345678/Blueprints/MyHelmet_C
```

The AI **cannot invent** these addresses. If it gets one letter wrong, the item does not exist for the game.

### The golden rule: the mod must be in Beacon first

For the AI to work with a mod, that mod must have been imported into Beacon beforehand. Once it's there, Beacon knows the exact address of all its items, and the AI just has to ask for them.

If the mod is not yet in Beacon → the AI can't do anything → you need to import it via Beacon's interface first.

### How does custom loot work?

Loot in Ark is like a **4-level Russian doll**:

```
The container (the crate, the beacon, the chest...)
  └── An item group (e.g.: "Armor")
        └── A slot (e.g.: "1 to 2 armor pieces")
              └── The possible items (e.g.: helmet OR chestplate OR leggings)
```

Each level has its own settings: minimum items, maximum items, quality, chance of getting a blueprint instead of a crafted item, etc.

The AI must understand and build this complete structure. It's doable, but it needs the mod to be properly referenced in Beacon to know the available items.

### What the AI can't know about mods

Even with the mod imported into Beacon, there are things the AI will have to guess:
- Is this mod compatible with another mod?
- What weight to give each item to make it balanced?
- Which crates are "safe" to modify without breaking vanilla gameplay?

For these points, the AI relies on its general Ark knowledge and what you specify.

---

## What it would take to launch this

Going from nothing to something that works:

**1. Make sure mods are in Beacon**
Import the mods you want to work with via the normal Beacon interface.

**2. Create the bridge between the AI and Beacon**
This is the main development work. It represents a few weeks of work for a developer.

**3. Connect the AI to this bridge**
Once the bridge is created, any compatible AI (Claude, ChatGPT, etc.) can use it.

**4. Test and refine**
Test concrete cases (loot, recipes, player management) and fix what doesn't work well.

| What we want to do | Ease | Note |
|--------------------|------|------|
| Manage projects and configs | Easy | Everything is already in Beacon |
| Create/modify loot | Medium | Doable if the mod is imported |
| Modify craft recipes | Medium | Same |
| Manage players and bans | Medium | Requires Sentinel access |
| Start/stop the server | Medium | Requires Connector installed |

---

## Key takeaways

- It's **feasible** and Beacon is well structured for it
- The AI's risk of error is **contained**: Beacon validates everything, the AI cannot corrupt data
- The real prerequisite for mods: **they must be imported into Beacon first**
- We **don't need** a large specialized data library to get started — modern LLMs handle 80% of common cases
- Enriching recommended values in Beacon is the best long-term evolution

---

*Document written on 2026-03-29 — Accessible version of MCP-BRIDGE.md*
