#define MyAppName "Beacon MCP"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "Beacon MCP"
#define MyAppExeName "Beacon-MCP-Setup.exe"

[Setup]
AppId={{9B9D3DAE-4A2A-4F3F-90D8-08D381A1E0B8}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\BeaconMCP
DisableDirPage=yes
DisableProgramGroupPage=yes
OutputDir=..\output
OutputBaseFilename=Beacon-MCP-Setup
Compression=lzma
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest

[Tasks]
Name: "configure_codex"; Description: "Configure Codex"; Flags: checkedonce
Name: "configure_claude"; Description: "Configure Claude Desktop"; Flags: checkedonce
Name: "configure_cursor"; Description: "Configure Cursor"; Flags: checkedonce
Name: "desktopicon"; Description: "Create a desktop shortcut for the first test helper"; Flags: unchecked

[Code]
function BuildInstallerParams(): String;
begin
  Result := '"' + ExpandConstant('{app}\installer-dist\cli.js') + '" --json-file "' + ExpandConstant('{app}\installer-result.json') + '"';

  if WizardIsTaskSelected('configure_codex') then
    Result := Result + ' --codex';
  if WizardIsTaskSelected('configure_claude') then
    Result := Result + ' --claude';
  if WizardIsTaskSelected('configure_cursor') then
    Result := Result + ' --cursor';
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;

  if CurPageID = wpSelectTasks then
  begin
    if not WizardIsTaskSelected('configure_codex') and
       not WizardIsTaskSelected('configure_claude') and
       not WizardIsTaskSelected('configure_cursor') then
    begin
      MsgBox(
        'Select at least one application to configure: Codex, Claude Desktop, or Cursor.',
        mbError,
        MB_OK
      );
      Result := False;
    end;
  end;
end;

function InitializeSetup(): Boolean;
var
  ResultCode: Integer;
begin
  if not Exec(ExpandConstant('{cmd}'), '/C node --version', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) or (ResultCode <> 0) then
  begin
    MsgBox(
      'Node.js 20 or later is required for this Beacon MCP installer version.' + #13#10#13#10 +
      'Please install Node.js, then run the installer again.',
      mbError,
      MB_OK
    );
    Result := False;
    exit;
  end;

  Result := True;
end;

[Files]
Source: "..\..\dist\*"; DestDir: "{app}\dist"; Flags: recursesubdirs ignoreversion
Source: "..\..\node_modules\*"; DestDir: "{app}\node_modules"; Flags: recursesubdirs ignoreversion
Source: "..\dist\*"; DestDir: "{app}\installer-dist"; Flags: recursesubdirs ignoreversion
Source: "..\..\package.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\.env.example"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist

[Icons]
Name: "{autodesktop}\Test Beacon MCP"; Filename: "{cmd}"; Parameters: "/K echo Ask your AI client: Call beacon_auth_status"; Tasks: desktopicon

[Run]
Filename: "node"; Parameters: "{code:BuildInstallerParams}"; Flags: runhidden waituntilterminated skipifsilent
Filename: "{cmd}"; Parameters: "/C echo Beacon MCP installed. Restart your AI apps and ask: Call beacon_auth_status"; Flags: postinstall shellexec skipifsilent
