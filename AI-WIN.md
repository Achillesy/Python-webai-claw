---
name: windows
description: Windows system tasks, PowerShell, paths, UAC, apps, screenshots, and services.
triggers: windows, win, powershell, cmd, registry, uac, service, startup, screenshot, clipboard
platforms: windows
version: 1
---

# AI-WIN.md - Windows skill

> Use this skill for Windows-specific work. Every `claw` command still needs
> `host` and exact `"v":3` as described in `AI-AGENT.md`.

## 1. First checks

- Read the platform, shell, hostname, and host version from the Connect
  attachment.
- Use the visible skill index to confirm that this skill is for the current
  machine.
- Prefer `$HOME` or `$env:USERPROFILE` over hard-coded drive paths.
- Quote paths that contain spaces.

## 2. PowerShell basics

```powershell
# Current user and system
$env:USERNAME
[Environment]::OSVersion.VersionString
$PSVersionTable.PSVersion

# Files and folders
Get-ChildItem $HOME
Get-ChildItem "$HOME\Downloads" -Filter *.png -Recurse

# Read a text file
Get-Content -TotalCount 200 "$HOME\Downloads\example.txt"

# Processes
Get-Process
Get-Process | Where-Object { $_.ProcessName -like "*name*" }

# Listening ports
Get-NetTCPConnection -State Listen
```

## 3. Execution policy and elevation

- Check the current policy before suggesting changes:

```powershell
Get-ExecutionPolicy -List
```

- Do not change machine-wide execution policy without explicit confirmation.
- Prefer a process-scoped policy for a single script when the user agrees.
- Some operations require UAC elevation. Explain why before asking the user to
  run an elevated command.
- Do not attempt to bypass UAC, SmartScreen, Defender, or application control.

## 4. Applications and files

```powershell
# Open an application
Start-Process "notepad.exe"

# Open a folder
Start-Process explorer.exe "$HOME\Downloads"

# Open a file with its default application
Invoke-Item "$HOME\Downloads\example.png"
```

For installed applications, inspect uninstall entries or Start Menu shortcuts
instead of guessing paths:

```powershell
Get-ItemProperty `
  "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*", `
  "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" |
  Select-Object DisplayName, DisplayVersion, InstallLocation
```

## 5. Services and startup items

```powershell
Get-Service
Get-Service | Where-Object { $_.Status -eq "Running" }
Get-CimInstance Win32_StartupCommand
```

Do not stop, disable, or delete a service or startup item without explicit user
confirmation.

## 6. Screenshots and clipboard

Screenshots can be captured through .NET without extra software:

```powershell
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
$path = "$env:TEMP\webai-claw-screen.png"
$bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
$path
```

Clipboard commands:

```powershell
Get-Clipboard
Set-Clipboard -Value "text"
```

Check screenshots for private information before attaching them.

## 7. Safety

- Do not use destructive commands such as `Remove-Item -Recurse -Force` without
  explicit confirmation and a clear target.
- Do not read passwords, tokens, browser cookies, credential stores, or private
  keys.
- Do not modify the registry, firewall, Defender, or security policy without
  user confirmation.
- For a command that may take a long time, follow the timeout guidance in
  `AI-AGENT.md`.
