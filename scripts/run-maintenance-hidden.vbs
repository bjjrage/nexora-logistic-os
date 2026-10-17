Option Explicit
Dim shell, files, workspace, nodeBinary, mode, scriptPath, command, result
If WScript.Arguments.Count <> 2 Then WScript.Quit 2
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
workspace = files.GetParentFolderName(files.GetParentFolderName(WScript.ScriptFullName))
nodeBinary = WScript.Arguments(0)
mode = WScript.Arguments(1)
If Not files.FileExists(nodeBinary) Then WScript.Quit 2
Select Case mode
  Case "monitor": scriptPath = files.BuildPath(workspace, "scripts\monitor.ts")
  Case "backup": scriptPath = files.BuildPath(workspace, "scripts\backup-os.ts")
  Case Else: WScript.Quit 2
End Select
If Not files.FileExists(scriptPath) Then WScript.Quit 2
shell.CurrentDirectory = workspace
command = Chr(34) & nodeBinary & Chr(34) & " --env-file=.env " & Chr(34) & scriptPath & Chr(34)
' Window style 0 hides the child console; wait preserves the task result and overlap protection.
result = shell.Run(command, 0, True)
WScript.Quit result
