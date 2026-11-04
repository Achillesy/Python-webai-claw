# AI-AGENT examples

These examples are for humans and documentation. The runtime AI receives
`AI-AGENT.md`; the examples are not required for command execution.

## 10. Examples

### List a directory

```claw
{"claw":"exec","id":"example-list-011","host":"<UUID>","cmd":"ls -la ~","v":3}
```

Windows:

```claw
{"claw":"exec","id":"example-list-012","host":"<UUID>","cmd":"Get-ChildItem $HOME","v":3}
```

### System information

macOS:

```claw
{"claw":"exec","id":"example-sys-013","host":"<UUID>","cmd":"sw_vers && uname -m && df -h","v":3}
```

Windows:

```claw
{"claw":"exec","id":"example-sys-014","host":"<UUID>","cmd":"Get-ComputerInfo | Select-Object WindowsProductName,OsVersion,CsSystemType","v":3}
```

### Git status

```claw
{"claw":"exec","id":"example-git-015","host":"<UUID>","v":3}
cd ~/Workspace/Python/webai-claw
git status --short
```

### Send a file to the user

```claw
{"claw":"attach","id":"example-att-016","host":"<UUID>","path":"~/Downloads/report.pdf","text":"Source report","v":3}
```

### Diagnose a silent run

```claw
{"claw":"diag","id":"example-diag-017","host":"<UUID>","v":3}
```

