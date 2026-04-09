# Beacon MCP — Transition Plan Toward a Standalone `.exe` Runtime

> Technical plan for evolving `Beacon-MCP` from a local runtime based on `node dist/index.js` to a standalone Windows executable such as `Beacon-MCP.exe`.

---

## Goal

The goal is to eventually remove the end-user dependency on Node.js for local `Beacon-MCP` installation.

The target outcome is:

- a standalone Windows executable
- simpler MCP client configuration
- better UX for non-technical users
- a Windows installer that no longer needs to verify Node.js

---

## Why Move to a `.exe`

The current `v1` runtime works, but it still requires:

- Node.js to be installed
- a version check
- possible local runtime conflicts
- extra installer complexity

A standalone `.exe` provides:

- no Node.js dependency on the user side
- a single target path
- more reliable startup behavior
- a simpler setup story

---

## Current State

Today, the local runtime is based on:

- `dist/index.js`
- `node_modules/`
- the command:

```text
node C:\Users\<user>\AppData\Local\BeaconMCP\dist\index.js
```

The `v1` installer:

- copies the runtime
- verifies Node.js
- configures MCP clients with `command = "node"`
- passes the `dist/index.js` path as an argument

---

## v2 Target

The `v2` target is:

```text
C:\Users\<user>\AppData\Local\BeaconMCP\Beacon-MCP.exe
```

And on the MCP client side:

### Codex

```toml
[mcp_servers.beacon]
command = "C:\\Users\\<user>\\AppData\\Local\\BeaconMCP\\Beacon-MCP.exe"
args = []
```

### Claude Desktop / Cursor

```json
{
  "mcpServers": {
    "beacon": {
      "command": "C:\\Users\\<user>\\AppData\\Local\\BeaconMCP\\Beacon-MCP.exe",
      "args": []
    }
  }
}
```

---

## Important Constraints

The transition to `.exe` must preserve:

- `stdio` mode
- current MCP behavior
- compatibility with Codex / Claude Desktop / Cursor
- local Beacon token storage
- the ability to keep HTTP mode later if desired

It must not:

- break existing tools
- change tool names
- alter the Beacon authentication workflow

---

## Possible Technical Options

### Option 1 — Bundle Node.js with the Project

Principle:

- embed the Node runtime with the app
- provide a launcher `.exe` or `.bat`

Advantages:

- easy to implement
- minimal refactor

Drawbacks:

- not a truly standalone runtime
- heavier payload
- less clean long term

Verdict:

- acceptable as an intermediate step
- not ideal as the final target

### Option 2 — Build a Standalone Executable from the Node Project

Principle:

- compile or package the TypeScript/Node server into a `.exe`

Possible tools:

- `pkg`
- `nexe`
- bundling + packaged runtime

Advantages:

- best UX
- simple distribution
- closer to the final product vision

Drawbacks:

- packaging can be sensitive depending on dependencies
- runtime behavior needs to be validated carefully

Verdict:

- best direction for `v2`

---

## Recommendation

The best path is:

1. keep `v1` on Node
2. prepare the code to work with an abstract runtime path
3. produce a first packaged `.exe`
4. adapt config patchers to write `command = <exe>`
5. then remove the Node.js dependency from the installer

---

## Code Preparation Before Packaging

Before generating a `.exe`, the system should become more abstract.

In particular, it should:

- separate Node runtime and `.exe` runtime concepts
- centralize `command` and `args` generation
- avoid code that assumes `node dist/index.js`

Today this mainly happens in:

- [install-path.ts](C:\Users\forgo\Documents\Code\Projet-Beacon\Beacon-MCP\installer\src\payload\install-path.ts)
- [codex-config.ts](C:\Users\forgo\Documents\Code\Projet-Beacon\Beacon-MCP\installer\src\config-patch\codex-config.ts)
- [claude-config.ts](C:\Users\forgo\Documents\Code\Projet-Beacon\Beacon-MCP\installer\src\config-patch\claude-config.ts)
- [cursor-config.ts](C:\Users\forgo\Documents\Code\Projet-Beacon\Beacon-MCP\installer\src\config-patch\cursor-config.ts)

---

## Recommended Refactor

Introduce a concept such as:

```ts
type RuntimeMode = "node" | "exe";
```

Then expose a centralized factory:

```ts
getRuntimeCommandConfig(mode)
```

Which returns:

- `command`
- `args`
- `entryPath`
- `runtimeLabel`

Example:

### `node` mode

- `command = "node"`
- `args = ["C:\\...\\dist\\index.js"]`

### `exe` mode

- `command = "C:\\...\\Beacon-MCP.exe"`
- `args = []`

This avoids spreading runtime assumptions across each patcher.

---

## Recommended Packaging Choice

### Primary Candidate: `pkg`

Why:

- well known for packaging Node apps into executables
- simple enough for an MVP technical phase
- suitable for CLI / `stdio` apps

Things to validate:

- compatibility with `@modelcontextprotocol/sdk`
- correct CommonJS import resolution
- correct inclusion of any required assets

### Alternative: `nexe`

Why:

- another option for building a Node executable

Downside:

- often more expensive to tune

### Practical Recommendation

Test in this order:

1. clean TypeScript build
2. local execution with `node dist/index.js`
3. prototype packaging with `pkg`
4. test in Codex / Claude / Cursor

---

## Installer Impact

Once the `.exe` is ready, the installer must evolve.

### What disappears

- the Node.js check
- the need to copy `node_modules/`
- the need to write `command = "node"`

### What changes

- copy `Beacon-MCP.exe`
- MCP configs point directly to the `.exe`
- runtime validation launches the executable directly

### What remains

- app detection
- config backup/patching
- post-install validation
- first-test guide

---

## Distribution Impact

### v1

Distributed payload:

- `dist/`
- `node_modules/`
- installer scripts

### v2

Distributed payload:

- `Beacon-MCP.exe`
- installer scripts
- optional docs

Result:

- lighter installation
- fewer files
- simpler maintenance

---

## Config Patcher Impact

Patchers should stop writing:

```text
command = "node"
args = ["...\\dist\\index.js"]
```

And instead write:

```text
command = "C:\\...\\Beacon-MCP.exe"
args = []
```

That implies:

- a shared abstraction
- installer-selected runtime mode
- temporary support for both `node` and `.exe`

---

## Recommended Migration Strategy

### Step 1 — Prepare Runtime Abstraction

Goal:

- support both `node` and `.exe` through the same config layer

Deliverable:

- centralized runtime helpers

### Step 2 — Produce a Prototype `.exe`

Goal:

- verify a standalone runtime starts correctly in `stdio`

Deliverable:

- first `Beacon-MCP.exe`

### Step 3 — Test Local MCP Compatibility

Goal:

- validate Codex
- validate Claude Desktop
- validate Cursor

Deliverable:

- compatibility matrix

### Step 4 — Adapt Patchers

Goal:

- write client configs in `.exe` mode

Deliverable:

- patchers compatible with the standalone runtime

### Step 5 — Adapt the Installer

Goal:

- remove the Node dependency

Deliverable:

- `v2` installer

### Step 6 — Gradually Retire the `node` Path

Goal:

- simplify the final product

Deliverable:

- distribution centered on the `.exe`

---

## Critical Test Points

Before fully adopting the `.exe` runtime, test:

- `stdio` startup
- MCP loading in Codex
- MCP loading in Claude Desktop
- MCP loading in Cursor
- Beacon auth
- project reads
- gamedata reads
- Sentinel behavior
- close / restart behavior

---

## Risks To Watch

- `.exe` runtime behaving differently from `node dist/index.js`
- incomplete packaging of dependencies
- Windows path behavior differences
- antivirus / SmartScreen issues
- harder debugging once packaged

---

## Recommended Deliverables

This phase should produce:

- `.exe` strategy doc
- runtime abstraction in `installer/`
- prototype `.exe` build
- local Codex / Claude / Cursor tests
- progressive installer adaptation

---

## Final Recommendation

The right strategy is not to replace `node dist/index.js` abruptly, but to:

- abstract the runtime first
- prove the `.exe`
- migrate the patchers
- then simplify the installer

In short:

> `v1` stabilizes local installation with Node, then `v2` cleanly replaces the runtime with `Beacon-MCP.exe`.
