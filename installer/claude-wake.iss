; קובץ ההתקנה של "הדלקת קלוד". נבנה ע"י build-release.ps1 (שמכין את build\app).
; התקנה למשתמש הנוכחי בלבד, בלי הרשאות מנהל, לתיקייה %LOCALAPPDATA%\ClaudeWake.
; התוכנה היא אשף וניהול בלבד: ההפעלה עצמה רצה בסקריפט בגוגל, ולכן אין הפעלה אוטומטית עם Windows.
#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif

[Setup]
AppId={{3E7A9C14-6B2D-4F58-A1C9-0D4E8B7F2A61}
AppName=הדלקת קלוד
AppVersion={#AppVersion}
DefaultDirName={localappdata}\ClaudeWake
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=output
OutputBaseFilename=ClaudeWake-Setup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
UninstallDisplayName=הדלקת קלוד
UninstallDisplayIcon={app}\icon.ico
SetupIconFile=icon.ico
CloseApplications=no

[Languages]
Name: "he"; MessagesFile: "compiler:Languages\Hebrew.isl"

[Files]
Source: "build\app\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{userprograms}\הדלקת קלוד"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\launcher.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\icon.ico"; Comment: "הגדרה וניהול של הדלקת קלוד"
Name: "{userdesktop}\הדלקת קלוד"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\launcher.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\icon.ico"; Comment: "הגדרה וניהול של הדלקת קלוד"

[Run]
Filename: "{win}\explorer.exe"; Parameters: """{userdesktop}\הדלקת קלוד.lnk"""; Description: "פתיחת אשף ההגדרה"; Flags: postinstall nowait skipifsilent

[UninstallRun]
; מסלול "מהמחשב": מוחקים את המשימות של התוכנה במתזמן המשימות של Windows
Filename: "powershell.exe"; Parameters: "-NoProfile -NonInteractive -Command ""Get-ScheduledTask -TaskPath '\ClaudeWake\' -ErrorAction SilentlyContinue | Unregister-ScheduledTask -Confirm:$false"""; Flags: runhidden waituntilterminated; RunOnceId: "RemoveTasks"

[UninstallDelete]
Type: filesandordirs; Name: "{app}\app"

[Code]
// בעדכון: סוגרים מופע פתוח של התוכנה (קובץ ui.json מכיל את מספר התהליך).
function PrepareToInstall(var NeedsRestart: Boolean): String;
var Code: Integer;
begin
  Result := '';
  Exec('powershell.exe', '-NoProfile -NonInteractive -Command "$f = Join-Path $env:APPDATA ''ClaudeWake\ui.json''; if (Test-Path $f) { $p = (Get-Content $f -Raw | ConvertFrom-Json).pid; Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }"', '', SW_HIDE, ewWaitUntilTerminated, Code);
end;

// בהסרה: המערכת בענן לא נמחקת. שואלים אם למחוק את ההגדרות המקומיות.
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
  begin
    MsgBox('הסקריפט בחשבון הגוגל שלך ממשיך לפעול. כדי לעצור אותו: script.google.com, הפרויקט "הדלקת קלוד", מחיקה.', mbInformation, MB_OK);
    if MsgBox('למחוק גם את ההגדרות המקומיות (כולל מפתח הניהול)? בלי המפתח לא תוכל לנהל את המערכת הקיימת מהמחשב הזה.', mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
      DelTree(ExpandConstant('{userappdata}\ClaudeWake'), True, True, True);
  end;
end;
