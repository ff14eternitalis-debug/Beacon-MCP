export function getFirstTestGuide(): string {
  return [
    "1. Restart Codex, Claude Desktop, or Cursor.",
    '2. Ask: "Call beacon_auth_status"',
    '3. If needed, ask: "Run beacon_login"',
    '4. Complete the login in your browser.',
    '5. Then ask: "Call beacon_login_check"',
    '6. Finally, ask: "Call beacon_list_projects"',
  ].join("\n");
}
