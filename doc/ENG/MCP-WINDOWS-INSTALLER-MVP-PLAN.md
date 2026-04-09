# Beacon MCP — MVP Action Plan for a Local Windows Installer

> Detailed action plan to deliver an MVP that non-technical users can actually use, with local Beacon-MCP installation, automatic MCP client configuration, and a guided first test.

---

## Goal

The target MVP is:

- `Beacon-MCP` packaged locally
- a simple Windows installer
- automatic configuration for Codex, Claude Desktop, and Cursor
- an immediately usable first-test guide

The goal is not just to "ship the MCP", but to let a non-technical user install and use it locally with as little friction as possible.

---

## Expected Outcome

A non-technical user should be able to:

1. download `Beacon-MCP-Setup.exe`
2. double-click it
3. choose which apps to configure
4. click `Install`
5. restart their AI client
6. type a simple first test:

```text
Call beacon_auth_status
```

---

## Recommended MVP

The best short-term MVP is:

- a local `Beacon-MCP` bundle ready to run
- a Windows installer
- automatic MCP client configuration
- a final screen with a guided first test

Recommended path:

- `v1`: installer + local Node bundle
- `v2`: installer + standalone `.exe`

---

## Target Architecture

### 1. Local Payload

The local payload should contain:

- a prebuilt `Beacon-MCP`
- either a Node bundle ready to run
- or, later, a standalone Windows executable
- support files needed for local usage
- a startup guide

Recommended install path:

```text
C:\Users\<user>\AppData\Local\BeaconMCP\
```

Example runtime targets:

- `C:\Users\<user>\AppData\Local\BeaconMCP\dist\index.js`
- `C:\Users\<user>\AppData\Local\BeaconMCP\Beacon-MCP.exe`

### 2. Windows Installer

The installer should be a simple graphical wizard that:

- detects Codex, Claude Desktop, and Cursor
- lets the user choose which apps to configure
- automatically writes MCP config files
- adds a shortcut or tool named `Test Beacon MCP`
- displays the next steps after installation

### 3. Post-Install Validation

After installation, the system should:

- verify that the Beacon-MCP binary or script starts
- verify that client config files were written correctly
- explain that restarting the applications is required
- display a simple test command:

```text
Call beacon_auth_status
```

---

## Ideal User Experience

Target flow:

1. Download `Beacon-MCP-Setup.exe`
2. Double-click it
3. Choose:
   - `Configure Codex`
   - `Configure Claude Desktop`
   - `Configure Cursor`
4. Click `Install`
5. Read the final screen:
   - `Beacon MCP has been installed`
   - `Codex configured`
   - `Claude configured`
   - `Restart your applications`
   - `First test: ask "Call beacon_auth_status"`

The flow must avoid:

- terminal usage
- `git`
- `npm`
- manual JSON or TOML editing
- copy-pasting file paths

---

## App Detection

The installer must detect at minimum:

### Codex

Expected file:

```text
C:\Users\<user>\.codex\config.toml
```

### Claude Desktop

Expected file:

- the Windows Claude Desktop config file

### Cursor

Expected file:

- the usual Cursor MCP config file

---

## States To Handle Per Application

For each detected client, the installer must handle 3 cases:

1. app detected + config writable
2. app detected but close/restart recommended
3. app not detected

Each case should be clearly explained in the installer UI.

---

## Beacon-MCP Execution Mode

### Option 1 — Embedded Node or JS Bundle

Advantages:

- faster to build
- lower initial cost
- compatible with the project's current architecture

Drawbacks:

- requires Node.js if not embedded
- less transparent for the general public

How it works:

- the installer copies files
- the MCP client runs `node dist/index.js`

### Option 2 — Standalone `.exe`

Advantages:

- best UX
- no Node.js required
- better for non-technical users

Drawbacks:

- more complex to build and maintain
- packaging is more demanding

### Recommendation

For this project:

- `v1`: installer + local bundle
- `v2`: installer + standalone `.exe`

---

## Automatic Configuration Per Client

The installer must automatically update client configs.

### Codex

Add a section such as:

```toml
[mcp_servers.beacon]
command = "node"
args = ["C:\\Users\\<user>\\AppData\\Local\\BeaconMCP\\dist\\index.js"]
```

### Claude Desktop

Add a `beacon` entry to `claude_desktop_config.json`.

### Cursor

Add a `beacon` entry to the Cursor MCP config file.

### Important Rules

The installer must never:

- overwrite the existing config
- remove other MCP servers
- replace the entire file when a merge is enough

The installer must always:

- create a backup before modification
- merge the `beacon` entry cleanly
- preserve the rest of the existing configuration

---

## Recommended Path

Recommended stable path:

```text
C:\Users\<user>\AppData\Local\BeaconMCP\
```

MCP clients should always point to a stable and predictable path.

Examples:

- `C:\Users\<user>\AppData\Local\BeaconMCP\dist\index.js`
- `C:\Users\<user>\AppData\Local\BeaconMCP\Beacon-MCP.exe`

This path should remain unchanged across updates.

---

## Minimum Installer Features

At minimum, the installer should:

- copy Beacon-MCP files
- back up existing configs
- modify MCP configs
- test server startup
- display a final summary
- offer `Open getting started guide`

Highly desirable features:

- detect whether apps are currently open
- display detected clients
- offer per-client selective installation
- report write permission errors clearly

---

## Recommended Final Screen

The final screen should display:

- `Installation complete`
- `Beacon MCP is ready for: Codex, Claude Desktop`
- `Cursor not detected`
- `Next step: restart your applications`
- `Recommended first test: Call beacon_auth_status`

Useful buttons or actions:

- `Open getting started guide`
- `Open install folder`
- `Close`

---

## First Test Guide

The installer should provide a short first-test guide.

Recommended content:

1. open Codex, Claude Desktop, or Cursor
2. ask:

```text
Call beacon_auth_status
```

3. if not connected, ask:

```text
Run beacon_login
```

4. complete Beacon login in the browser
5. then run:

```text
Call beacon_login_check
```

6. then test:

```text
Call beacon_list_projects
```

---

## Attention Points

The MVP must already anticipate:

- update handling
- config backup and restoration
- clean uninstallation
- coexistence with other MCP servers
- Beacon OAuth token storage location
- detection of a missing Node runtime if `v1` still depends on Node
- write permissions for client config files

---

## Update Strategy

The MVP should already lay the groundwork for clean updates:

- keep a fixed install folder
- version the installed payload
- keep backups of client configs
- allow Beacon-MCP files to be replaced without breaking the existing MCP setup

---

## Uninstallation

Even if simple at first, uninstall should be planned from the beginning.

It should:

- remove installed files
- offer to remove the `beacon` entry from client configs
- keep or remove backups based on user choice
- explain that local Beacon tokens can remain if desired

---

## MVP Deliverables

The MVP should produce:

- a standard local install folder
- a prebuilt Beacon-MCP runtime
- a Windows installer
- an app detection script or module
- a Codex config patch module
- a Claude Desktop config patch module
- a Cursor config patch module
- a server startup test
- a user-facing first-test guide

---

## Concrete Roadmap

### Step 1 — Create a Standard Install Folder

Goal:

- define the install path
- lock the local file structure

Deliverable:

- a stable install tree under `AppData\Local\BeaconMCP`

### Step 2 — Stabilize Local Startup

Goal:

- guarantee that Beacon-MCP always starts locally from the installed payload

Deliverable:

- a reliable launch command
- an automatable local startup test

### Step 3 — Write an Automatic Configuration Script

Goal:

- detect installed clients
- patch their config files safely

Deliverable:

- read / backup / merge / write modules

### Step 4 — Build the Windows Installer

Goal:

- provide a non-technical setup wizard

Deliverable:

- `Beacon-MCP-Setup.exe`

### Step 5 — Add a Post-Install Validation Screen

Goal:

- reassure the user
- confirm the installation really works

Deliverable:

- final screen with per-application status and recommended first test

### Step 6 — Add an Uninstaller

Goal:

- guarantee clean removal

Deliverable:

- uninstall routine

### Step 7 — Move to a Standalone `.exe`

Goal:

- remove the possible Node.js dependency
- improve the public-facing user experience

Deliverable:

- Beacon-MCP packaged as a standalone executable

---

## Recommended MVP Decisions

To keep scope under control, these decisions should be fixed:

- primary target: Windows
- primary clients: Codex + Claude Desktop + Cursor
- initial distribution: local installer
- initial runtime: local Node bundle
- install path: `AppData\Local\BeaconMCP`
- UX strategy: automatic detection + automatic configuration + restart prompt + guided first test

---

## Final Recommendation

The best Beacon-MCP MVP for non-technical users is:

- a prebuilt local runtime
- a graphical Windows installer
- automatic MCP client configuration
- post-install validation
- a first-test guide centered on `beacon_auth_status`

The core idea is simple:

> the user should not need to code, edit config files, or understand MCP in order to start using Beacon-MCP locally.
