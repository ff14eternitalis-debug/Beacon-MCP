# Beacon MCP Installer

Windows installer workspace for the local Beacon-MCP distribution.

This folder contains:

- installer-specific source code
- client detection logic
- MCP config patch logic
- payload preparation logic
- post-install validation
- uninstall helpers
- build and packaging assets

Recommended implementation order:

1. app detection
2. config backup and patching
3. payload copy and runtime checks
4. post-install validation
5. Windows packaging

Current entrypoint choice:

- primary: a Node installer runner that can be called by a Windows installer
- secondary: terminal usage for developers through `node dist/cli.js`

Why this choice:

- a real interactive CLI is not the best UX for end users
- a Node runner is easy to integrate into Inno Setup later
- developers still keep a terminal entrypoint for testing

Current useful commands:

- `npm run build`
- `npm run detect`
- `npm run install:run`
- `node dist/cli.js --check-node`
- `node dist/cli.js --install-defaults --json-file C:\\path\\result.json`

Current v1 prerequisite:

- Node.js 20 or later must be available in `PATH`
- the runner checks this explicitly before installation
