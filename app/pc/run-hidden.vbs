' Runs a PowerShell script of Claude Wake without a console window.
' Usage: wscript run-hidden.vbs <script.ps1> [args...]
Set sh = CreateObject("WScript.Shell")
If WScript.Arguments.Count = 0 Then WScript.Quit 1
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & WScript.Arguments(0) & """"
For i = 1 To WScript.Arguments.Count - 1
  cmd = cmd & " """ & WScript.Arguments(i) & """"
Next
sh.Run cmd, 0, False
