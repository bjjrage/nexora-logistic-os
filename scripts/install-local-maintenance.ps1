$ErrorActionPreference='Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$nodeBinary=(Get-Command node.exe).Source
$backupScript=Join-Path $workspace 'scripts\backup-os.ts'
$monitorScript=Join-Path $workspace 'scripts\monitor.ts'
if(-not(Test-Path -LiteralPath (Join-Path $workspace '.env'))){throw 'Falta configuración privada .env.'}
$settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
$principal=New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$backup=New-ScheduledTaskAction -Execute $nodeBinary -Argument "--env-file=.env `"$backupScript`"" -WorkingDirectory $workspace
$monitor=New-ScheduledTaskAction -Execute $nodeBinary -Argument "--env-file=.env `"$monitorScript`"" -WorkingDirectory $workspace
$backupTrigger=New-ScheduledTaskTrigger -Daily -At '03:30'
$monitorTrigger=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName 'Nexora OS - backup privado' -Action $backup -Trigger $backupTrigger -Settings $settings -Principal $principal -Description 'Copia local privada de los esquemas del OS; requiere sesión Windows activa y conexión.' -Force | Out-Null
Register-ScheduledTask -TaskName 'Nexora OS - monitor local' -Action $monitor -Trigger $monitorTrigger -Settings $settings -Principal $principal -Description 'Comprueba OS, web y GPS cada minuto. Sin proveedor de correo registra alertas localmente.' -Force | Out-Null
Get-ScheduledTask -TaskName 'Nexora OS - *' | Select-Object TaskName,State
