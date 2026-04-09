import assert from "node:assert/strict";

import {
  appendLinesToShooterGameIni,
  buildNamedEngramEntryOverride,
  buildProjectChatExport,
  buildProjectFileExport,
  extractEngramOverrideLines,
  sanitizeFileSegment,
  type JsonRecord,
} from "../tools/projects/shared.js";

function testBuildNamedEngramEntryOverride() {
  const line = buildNamedEngramEntryOverride({
    "Entry String": "EngramEntry_TekForge_CS_C",
    "Player Level": 180,
    "Unlock Points": 0,
  });

  assert.equal(
    line,
    'OverrideNamedEngramEntries=(EngramClassName="EngramEntry_TekForge_CS_C",EngramLevelRequirement=180,EngramPointsCost=0)'
  );
}

function testExtractEngramOverrideLines() {
  const v7data: JsonRecord = {
    configSetData: {
      "94c9797d-857d-574a-bdb9-30ee6543ed12": {
        "ArkSA.EngramControl": {
          Overrides: {
            Attributes: [
              {
                "Entry String": "EngramEntry_TekForge_CS_C",
                "Player Level": 180,
                "Unlock Points": 0,
              },
            ],
          },
        },
      },
    },
  };

  const lines = extractEngramOverrideLines("arksa", v7data);
  assert.deepEqual(lines, [
    'OverrideNamedEngramEntries=(EngramClassName="EngramEntry_TekForge_CS_C",EngramLevelRequirement=180,EngramPointsCost=0)',
  ]);
}

function testAppendLinesToShooterGameIni() {
  const input = "[/script/shootergame.shootergamemode]\nSupplyCrateLootQualityMultiplier=1.000000";
  const output = appendLinesToShooterGameIni(input, [
    'OverrideNamedEngramEntries=(EngramClassName="EngramEntry_TekForge_CS_C",EngramLevelRequirement=180,EngramPointsCost=0)',
  ]);

  assert.match(output, /SupplyCrateLootQualityMultiplier=1\.000000/);
  assert.match(output, /OverrideNamedEngramEntries=\(EngramClassName="EngramEntry_TekForge_CS_C"/);
}

function testBuildProjectChatExportOverridesOnly() {
  const result = buildProjectChatExport("project-1", "arksa", "all", "overrides_only", {
    derivedGameIniLines: [
      'OverrideNamedEngramEntries=(EngramClassName="EngramEntry_TekForge_CS_C",EngramLevelRequirement=180,EngramPointsCost=0)',
    ],
  });

  assert.match(result.message, /OverrideNamedEngramEntries/);
  assert.equal(result.payload.format, "overrides_only");
}

function testBuildProjectFileExportOverridesOnly() {
  const result = buildProjectFileExport("project-1", "test tek forge 180", "arksa", "all", undefined, "overrides_only", {
    derivedGameIniLines: [
      'OverrideNamedEngramEntries=(EngramClassName="EngramEntry_TekForge_CS_C",EngramLevelRequirement=180,EngramPointsCost=0)',
    ],
  });

  assert.match(result.content, /Project: test tek forge 180/);
  assert.match(result.content, /OverrideNamedEngramEntries/);
}

function testSanitizeFileSegment() {
  assert.equal(sanitizeFileSegment("test tek forge 180"), "test-tek-forge-180");
  assert.equal(sanitizeFileSegment("[ARCHIVE] LOOTS /// Astraeos"), "archive-loots-astraeos");
}

function main() {
  testBuildNamedEngramEntryOverride();
  testExtractEngramOverrideLines();
  testAppendLinesToShooterGameIni();
  testBuildProjectChatExportOverridesOnly();
  testBuildProjectFileExportOverridesOnly();
  testSanitizeFileSegment();
  console.log("projects smoke tests passed");
}

main();
