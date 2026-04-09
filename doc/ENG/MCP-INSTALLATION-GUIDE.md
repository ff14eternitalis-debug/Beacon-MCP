# Beacon MCP — Installation Guide

> User installation guide for `Beacon-MCP`, covering the current terminal-based installation, the `v1` installer runner for testing, and the future Windows executable installation.

---

## Goal

This guide explains how to install `Beacon-MCP` locally using three methods:

- **current method**: terminal-based installation
- **intermediate method**: developer installer runner
- **future method**: Windows executable installation

The goal is to help users choose the right path for their technical level.

---

## Which Method To Choose

### Method 1 — Terminal Installation

Use this if:

- you are comfortable with the terminal
- you want to test the current version of the project
- you want to follow the project while it is being developed

### Method 2 — `v1` Installer Runner

Use this if:

- you want to test the current installer logic
- you are fine still using Node.js
- you want to avoid part of the manual client configuration

### Method 3 — Windows `.exe` Installation

Use this if:

- you do not want to use the terminal
- you want a simpler setup flow
- you are waiting for a more mainstream user-friendly version

Today:

- terminal installation is available
- the `v1` installer runner is available for testing
- `.exe` installation is being prepared

---

## General Prerequisites

To use `Beacon-MCP`, you need:

- a Beacon account
- an internet connection
- at least one local MCP client:
  - Codex
  - Claude Desktop
  - Cursor

Depending on what you want to do, you may also need:

- a Beacon project
- optionally a Sentinel service
- optionally the Beacon Connector if you want to control a local server

---

## Current Installation — Terminal Method

### Specific Prerequisites

You need:

- Node.js 20 or later
- `git`

### Steps

1. clone the repository
2. install dependencies
3. build the project

Commands:

```bash
git clone https://github.com/ff14eternitalis-debug/Beacon-MCP.git
cd Beacon-MCP
npm install
npm run build
```

---

## MCP Client Configuration In Terminal Mode

### Codex

Add this block to:

```text
C:\Users\<user>\.codex\config.toml
```

```toml
[mcp_servers.beacon]
command = "node"
args = ["C:\\path\\to\\Beacon-MCP\\dist\\index.js"]
```

### Claude Desktop

Add this to the Claude Desktop config file:

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

### Cursor

Add a `beacon` entry to the Cursor MCP config file.

---

## First Use After Terminal Installation

1. restart your MCP client
2. ask:

```text
Call beacon_auth_status
```

3. if needed, ask:

```text
Run beacon_login
```

4. complete the login in your browser
5. then ask:

```text
Call beacon_login_check
```

6. then test:

```text
Call beacon_list_projects
```

---

## Current Installation — `v1` Installer Runner

This method is mainly for developers and testers who want to validate the local installation flow before the Windows `.exe` is ready.

### Specific Prerequisites

You need:

- Node.js 20 or newer
- the project already downloaded locally

### Steps

From the `Beacon-MCP` root:

```bash
cd installer
npm run build
node dist/cli.js --detect
node dist/cli.js --check-node
node dist/cli.js --install-defaults
```

### What this runner does

- detects Codex, Claude Desktop, and Cursor
- copies the Beacon MCP runtime to a stable local folder
- backs up and patches supported MCP client configs
- verifies that the runtime starts correctly

### Current limitation

This is not yet the final public-facing experience.

The Windows `.exe` remains the target path for non-technical users.

---

## Future Installation — `.exe` Method

Once the Windows installer is ready, the recommended flow will be:

1. download `Beacon-MCP-Setup.exe`
2. double-click it
3. choose which apps to configure:
   - Codex
   - Claude Desktop
   - Cursor
4. click `Install`
5. restart the AI app
6. run the first test:

```text
Call beacon_auth_status
```

---

## What the `.exe` Installer Will Do

The Windows installer will:

- install `Beacon-MCP` locally
- detect Codex, Claude Desktop, and Cursor
- automatically configure MCP client files
- back up existing configs
- verify that the Beacon-MCP runtime starts
- display a first-test guide

---

## Difference Between Terminal and Future `.exe` Versions

### Terminal Version

Advantages:

- available now
- ideal for testing and developers
- gives full control

Drawbacks:

- more technical
- requires Node.js
- requires manual or semi-manual configuration

### `.exe` Version

Advantages:

- easier for non-technical users
- better UX
- automatic MCP client configuration

Drawbacks:

- not yet the final public path
- still depends on the ongoing installer work

---

## What To Do If You Do Not Want To Use The Terminal

If you do not want to use the terminal:

- wait for the `.exe` version
- or ask a technical user to install the current version for you

After that, the MCP can still be used normally inside the AI client.

---

## Quick Troubleshooting

### The MCP does not appear in the client

Check:

- that the client has been restarted
- that the path to `dist/index.js` is correct
- that the client config file is valid

### `beacon_auth_status` does not work

Check:

- that the MCP is actually loaded
- that internet access works

### Beacon asks for login

This is normal on first use.

Run:

```text
Run beacon_login
```

Then complete the login at:

```text
https://usebeacon.app/device
```

---

## Useful Documentation

Related documents:

- [README](C:\Users\forgo\Documents\Code\Projet-Beacon\Beacon-MCP\README.md)
- [v1 Test Plan](C:\Users\forgo\Documents\Code\Projet-Beacon\Beacon-MCP\doc\ENG\MCP-V1-TEST-PLAN.md)
- [Windows Installer MVP Plan](C:\Users\forgo\Documents\Code\Projet-Beacon\Beacon-MCP\doc\ENG\MCP-WINDOWS-INSTALLER-MVP-PLAN.md)
- [`.exe` Runtime Transition Plan](C:\Users\forgo\Documents\Code\Projet-Beacon\Beacon-MCP\doc\ENG\MCP-EXE-RUNTIME-TRANSITION-PLAN.md)

---

## Final Recommendation

Today, the right installation method depends on the user profile:

- **technical users**: terminal installation
- **non-technical users**: wait for the `.exe` installer

In every case, the first real test should still be:

```text
Call beacon_auth_status
```
