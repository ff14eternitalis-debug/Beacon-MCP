# Beacon MCP — Technical Design for the Windows Installer

> Technical document to frame the implementation of the local Windows installer MVP: installer project structure, configuration patch scripts, distribution format, and Windows installer framework choice.

---

## Goal

This document defines how to build the local `Beacon-MCP` installation MVP for non-technical users.

The scope covered here is:

- installer project structure
- configuration patch scripts
- distribution format
- Windows installer framework choice

---

## Expected Outcome

At the end of this phase, the team should be able to:

- produce a locally installable payload
- detect Codex, Claude Desktop, and Cursor
- patch their MCP configs safely
- ship a simple Windows installer
- prepare a future move toward a standalone `.exe`

---

## 1. Recommended Installer Project Structure

The installer should be isolated from the MCP core while staying in the same repository.

Recommended structure:

```text
Beacon-MCP/
├── dist/
├── src/
├── doc/
├── installer/
│   ├── assets/
│   ├── scripts/
│   ├── templates/
│   ├── build/
│   ├── output/
│   ├── package.json
│   ├── tsconfig.json
│   └── README.md
└── README.md
```

### Role of Each Folder

#### `installer/assets/`

Contains:

- icons
- banner images
- logos
- UI text assets

#### `installer/scripts/`

Contains:

- installed client detection
- config file backup
- config patching
- Beacon-MCP file copy logic
- post-install validation
- uninstall logic

#### `installer/templates/`

Contains:

- sample config fragments
- JSON templates
- TOML templates
- final messages

#### `installer/build/`

Contains:

- installer build scripts
- payload generation logic
- final assembly steps

#### `installer/output/`

Contains:

- generated artifacts
- `.exe` builds
- `.zip` builds
- optional manifests

---

## 2. Recommended Technical Substructure

A more detailed structure can be:

```text
installer/
├── src/
│   ├── app-detection/
│   │   ├── codex.ts
│   │   ├── claude.ts
│   │   └── cursor.ts
│   ├── config-patch/
│   │   ├── codex-config.ts
│   │   ├── claude-config.ts
│   │   ├── cursor-config.ts
│   │   └── backup.ts
│   ├── payload/
│   │   ├── install-path.ts
│   │   ├── copy-runtime.ts
│   │   └── runtime-check.ts
│   ├── post-install/
│   │   ├── validation.ts
│   │   └── first-test.ts
│   ├── uninstall/
│   │   └── remove.ts
│   ├── types/
│   └── index.ts
├── assets/
├── templates/
├── build/
└── output/
```

This cleanly separates:

- detection
- config patching
- runtime installation
- validation
- uninstall

---

## 3. Configuration Patch Scripts

Config patch scripts are a critical part of the MVP.

They must be:

- safe
- idempotent
- non-destructive
- independently testable outside the installer UI

---

## 4. General Patch Rules

Each config patch must:

1. locate the target file
2. verify it is readable
3. create a backup
4. parse existing content
5. detect whether the `beacon` entry already exists
6. merge or update the `beacon` entry
7. write the result
8. reread the file to verify the write

It must never:

- overwrite the whole file without parsing
- remove other MCP servers
- assume the config is empty

---

## 5. Codex Config Patch

### Target File

```text
C:\Users\<user>\.codex\config.toml
```

### Expected Block

```toml
[mcp_servers.beacon]
command = "node"
args = ["C:\\Users\\<user>\\AppData\\Local\\BeaconMCP\\dist\\index.js"]
```

### Constraints

- preserve all other sections in the file
- only modify `mcp_servers.beacon`
- keep TOML valid

### Recommendation

Use a reliable TOML parser rather than naive text replacement.

---

## 6. Claude Desktop Config Patch

### Target File

- the Windows Claude Desktop config file

### Expected Structure

Add a `beacon` entry inside `mcpServers`.

Example:

```json
{
  "mcpServers": {
    "beacon": {
      "command": "node",
      "args": [
        "C:\\Users\\<user>\\AppData\\Local\\BeaconMCP\\dist\\index.js"
      ]
    }
  }
}
```

### Constraints

- do not remove other MCP servers
- keep JSON valid
- format cleanly after writing

---

## 7. Cursor Config Patch

### Target File

- the usual Cursor MCP config file

### Expected Structure

Add a `beacon` entry inside `mcpServers`.

### Constraints

- preserve existing JSON
- do not break other MCP entries

---

## 8. Config Backup

Before any modification, create a backup.

Recommended format:

```text
<file>.bak
```

or

```text
<file>.YYYYMMDD-HHMMSS.bak
```

Minimum requirement:

- one backup per modified file
- restoration must be possible on failure

---

## 9. Application Detection

Each client should have its own dedicated detection module.

Each module should return:

- `detected`
- `configPath`
- `isWritable`
- `isRunning`
- `recommendedAction`

Example internal type:

```ts
type ClientDetectionResult = {
  client: "codex" | "claude" | "cursor";
  detected: boolean;
  configPath?: string;
  isWritable?: boolean;
  isRunning?: boolean;
  recommendedAction?: "configure" | "restart_recommended" | "not_found" | "read_only";
};
```

---

## 10. Post-Install Validation

The validation module should verify:

- the runtime was copied successfully
- the target path exists
- the Beacon-MCP runtime starts
- config was written for selected clients

Recommended checks:

- install path exists
- runtime exists
- local runtime execution with a short timeout
- reread patched config files

---

## 11. Recommended Distribution Format

For the MVP, separate:

- internal build format
- external user-facing distribution format

### Internal Format

The build payload can be:

- a `runtime/` folder
- an `installer/output/` folder
- a simple version manifest

### External Format

The MVP should distribute:

1. an installer `.exe`
2. optionally a portable `.zip` for support or debugging

### Recommendation

Primary distribution:

- `Beacon-MCP-Setup.exe`

Secondary distribution:

- `Beacon-MCP-Portable.zip`

Why:

- the `.exe` simplifies the user experience
- the `.zip` helps support and troubleshooting

---

## 12. Recommended v1 Payload

For `v1`, the payload embedded in the installer can contain:

- `dist/`
- `node_modules/`
- `.env.example`
- getting started guide
- optionally a test script

Goal:

- avoid requiring `npm install`
- avoid requiring `npm run build`

---

## 13. Recommended v2 Payload

For `v2`, replace the Node runtime with:

- `Beacon-MCP.exe`

Advantages:

- no Node.js dependency
- simpler client configuration
- better user reliability

---

## 14. Windows Installer Framework Choice

We need to distinguish:

- preparation and patching logic
- installer packaging framework

---

## 15. Possible Options

### Option A — Inno Setup

Advantages:

- mature
- widely used on Windows
- good for building a real `.exe` installer
- strong support for shortcuts, uninstall, and file installation

Drawbacks:

- more traditional UI
- less comfortable scripting than TypeScript for complex logic

Verdict:

- excellent candidate for the final installer

### Option B — NSIS

Advantages:

- lightweight
- classic choice

Drawbacks:

- less pleasant to maintain
- scripting is less comfortable

Verdict:

- possible, but less attractive

### Option C — Electron / Tauri for an Installer UI

Advantages:

- modern UI
- more flexible guided experience

Drawbacks:

- heavier
- too expensive for an MVP

Verdict:

- interesting later, not necessary for the MVP

### Option D — PowerShell + Minimal UI

Advantages:

- fast to prototype
- easy for system scripting

Drawbacks:

- weaker UX
- less reassuring for mainstream users

Verdict:

- very good for an internal prototype
- less good for public distribution

---

## 16. Framework Recommendation

For the MVP:

- business logic in TypeScript or Node under `installer/`
- Windows packaging and installation through **Inno Setup**

This combination provides:

- testable logic
- maintainable config patching
- a real Windows `.exe`
- standard uninstall support

---

## 17. Responsibility Split

### Node / TypeScript Scripts

Responsible for:

- detecting apps
- backing up configs
- parsing and patching configs
- validating the installation
- generating files to embed

### Windows Installer Framework

Responsible for:

- copying files
- creating shortcuts
- handling install/uninstall
- optionally launching post-install scripts
- displaying user-facing screens

---

## 18. Recommended MVP Decision

Recommended choice:

- runtime: local Node bundle
- install logic: TypeScript/Node
- Windows installer: Inno Setup
- distribution: `Beacon-MCP-Setup.exe`

This is the best compromise between:

- delivery speed
- robustness
- maintainability
- user experience

---

## 19. Expected Technical Deliverables

This technical phase should produce:

- `installer/` structure
- Codex detection module
- Claude Desktop detection module
- Cursor detection module
- Codex TOML patch
- Claude JSON patch
- Cursor JSON patch
- backup/restore system
- post-install validation
- runtime packaging
- Inno Setup script

---

## 20. Recommended Implementation Order

1. create the `installer/` structure
2. implement client detection
3. implement backups
4. implement config patching
5. implement Beacon-MCP startup test
6. generate the local installable payload
7. write the Inno Setup script
8. test the full install flow on a clean Windows machine

---

## Final Recommendation

To move fast and stay clean:

- separate installer logic from MCP logic
- write robust, testable config patchers
- use a stable install path
- distribute a real Windows installer
- keep `v1` simple with embedded Node or a local bundle
- reserve the standalone `.exe` for `v2`

The most cost-effective decision at this stage is:

> `installer/` in TypeScript + Windows packaging with Inno Setup.
