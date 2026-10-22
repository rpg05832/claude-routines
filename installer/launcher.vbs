' Starts Claude Wake without a console window and opens its app window.
' --use-system-ca: trust the Windows certificate store (needed behind NetFree).
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
base = fso.GetParentFolderName(WScript.ScriptFullName)
args = ""
For Each a In WScript.Arguments
  args = args & " " & a
Next
sh.CurrentDirectory = base & "\app"
sh.Run """" & base & "\runtime\node.exe"" --no-warnings --use-system-ca """ & base & "\app\server.mjs""" & args, 0, False
