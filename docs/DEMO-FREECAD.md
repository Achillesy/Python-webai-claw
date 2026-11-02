# FreeCAD + webai-claw video demo plan

Status: planning. Target: a 12-18 minute bilingual demo video.

Language plan:

- On-screen prompts and terminal commands: English.
- Voiceover and Chinese operation notes: Chinese.
- English subtitles: recommended for international viewers.

## 1. Feasibility assessment

Overall: **feasible, with three prerequisites**.

| Item | Assessment |
| --- | --- |
| Windows 11 ARM64 VM | Workable, but FreeCAD's official Windows build is x64 and runs through Windows emulation. Test the viewport and startup time before recording. |
| FreeCAD | FreeCAD 1.1.x is sufficient. Use the x64 Windows build. |
| FreeCAD MCP addon | The `neka-nat/freecad-mcp` addon supports FreeCAD 1.0/1.1 and exposes a local XML-RPC bridge on `127.0.0.1:9875`. |
| webai-claw | Use the **1.2.2 development build**, not the 1.1.8 store build. 1.1.8 lacks `write_file` and custom skill authoring. |
| DeepSeek web | The existing adapter works. Use English prompts in the chat. |
| AI-created skill | Feasible with 1.2.2: `write_file` creates `custom/AI-FREECAD.md`, and the host validates its frontmatter. |
| Actual MCP stdio server | Optional for this demo. The skill can call the FreeCAD MCP addon's local RPC endpoint through a small stdlib helper. A generic MCP stdio bridge is a future enhancement. |

The one honest caveat: this demo uses the FreeCAD MCP addon's **RPC endpoint**, not a full MCP client inside the browser AI. The browser AI cannot speak MCP directly; it uses `exec` to call a local Python helper, which calls the addon. The video should state this clearly.

## 2. Recommended demo design

### Target object

A 3D-printable drop-in divider insert for a tin pencil box.

External box dimensions given by the user:

```text
189 mm x 85 mm x 18 mm
```

Assumptions for the demo:

- Sheet thickness: 1.5 mm.
- Insert clearance: 2.0 mm per side.
- Insert outer footprint: **184 mm x 80 mm**.
- Insert height: **15 mm**.
- Wall and divider thickness: **1.4 mm**.
- Bottom thickness: **1.2 mm**.
- One longitudinal divider at y = 40 mm.
- Two cross dividers in the back row at x = 60 mm and x = 120 mm.
- Result: one long front compartment and three back compartments.
- Export `FCStd`, `STEP`, and `STL` to:
  `C:\Users\Public\webai-claw-demo\`.

The video should show these assumptions on screen. Do not claim the insert fits every 189 x 85 x 18 mm tin; recommend measuring the internal dimensions for a production print.

## 3. Environment

- macOS on Apple Silicon.
- Windows 11 ARM64 virtual machine with network access.
- Chrome or Edge inside the VM.
- Python 3.12 for Windows.
- Git for Windows.
- `uv` / `uvx`.
- FreeCAD 1.1.x Windows x64.
- webai-claw 1.2.2 unpacked extension and native host.
- DeepSeek web chat.

Recommended VM resources:

- 4 CPU cores.
- 8 GB RAM.
- 20 GB free disk space.
- Hardware acceleration enabled.
- 1920x1080 display for recording.

## 4. Pre-recording checklist

- [ ] Test FreeCAD startup and 3D viewport in the ARM64 VM.
- [ ] Confirm the FreeCAD addon appears in the workbench list.
- [ ] Confirm `Test-NetConnection 127.0.0.1 -Port 9875` succeeds.
- [ ] Confirm webai-claw Connect works in Chrome/Edge inside the VM.
- [ ] Confirm DeepSeek can send a test `exec` block.
- [ ] Prepare an isolated demo folder:
      `C:\Users\Public\webai-claw-demo`.

      ```powershell
      New-Item -ItemType Directory -Force "C:\Users\Public\webai-claw-demo" | Out-Null
      ```
- [ ] Hide or blur the real machine UUID and personal paths.
- [ ] Rehearse the AI prompts and the FreeCAD RPC startup.
- [ ] Record at 1080p; use a clean desktop and large fonts.

## 5. English commands for the Windows VM

### 5.1 Verify Windows and winget

```powershell
Get-ComputerInfo | Select-Object OsName, OsArchitecture, OsVersion
winget --version
```

Expected: Windows 11 ARM64 and a working `winget`.

### 5.2 Install Python, Git, and uv

```powershell
winget install --id Python.Python.3.12 -e --accept-package-agreements --accept-source-agreements
winget install --id Git.Git -e --accept-package-agreements --accept-source-agreements
powershell -ExecutionPolicy Bypass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

Close and reopen PowerShell, then verify:

```powershell
py -3.12 --version
git --version
uv --version
uvx --version
```

### 5.3 Install the 1.2.2 extension and native host

Clone the demo build and install the native host in the Windows VM:

```powershell
$repo = Join-Path $HOME "webai-claw"
if (Test-Path $repo) { Remove-Item -Recurse -Force $repo }
git clone --depth 1 https://github.com/Achillesy/Python-webai-claw.git $repo
py -3 -c "import urllib.request; exec(urllib.request.urlopen('https://raw.githubusercontent.com/Achillesy/Python-webai-claw/master/native-host/install.py').read())"
```

In Chrome or Edge:

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select `%USERPROFILE%\webai-claw\extension`.
5. Confirm the popup shows extension `v1.2.2` and host `v1.2.2`.

The bundled development key keeps the extension ID stable and allowlisted by the
installer. Do not use the 1.1.8 store build for this demo; it has no `write_file`
or custom skill authoring.

### 5.4 Install FreeCAD

```powershell
winget install --id FreeCAD.FreeCAD -e --accept-package-agreements --accept-source-agreements
```

Verify:

```powershell
winget list --id FreeCAD.FreeCAD
Get-ChildItem "$env:ProgramFiles" -Filter "FreeCAD*" | Select-Object FullName
```

Note: the Windows build is x64 and runs through Windows ARM64 emulation. Allow extra startup time.

### 5.5 Install the FreeCAD MCP addon

```powershell
$repo = Join-Path $HOME "freecad-mcp"
if (Test-Path $repo) { Remove-Item -Recurse -Force $repo }
git clone --depth 1 https://github.com/neka-nat/freecad-mcp.git $repo

$mod = Join-Path $env:APPDATA "FreeCAD\v1-1\Mod"
New-Item -ItemType Directory -Force $mod | Out-Null
Copy-Item -Recurse -Force (Join-Path $repo "addon\FreeCADMCP") (Join-Path $mod "FreeCADMCP")
```

Expected path:

```text
%APPDATA%\FreeCAD\v1-1\Mod\FreeCADMCP\InitGui.py
```

### 5.6 Start FreeCAD and the RPC server

Find and launch FreeCAD:

```powershell
$exe = Get-ChildItem "$env:ProgramFiles\FreeCAD*" -Filter "FreeCAD.exe" -Recurse |
  Select-Object -First 1 -ExpandProperty FullName
Start-Process $exe
```

In FreeCAD:

1. Restart FreeCAD after copying the addon.
2. Select **MCP Addon** from the workbench selector.
3. Click **Start RPC Server** in the **FreeCAD MCP** toolbar.
4. Confirm the Report View shows `127.0.0.1:9875`.

Verify from PowerShell:

```powershell
Test-NetConnection 127.0.0.1 -Port 9875
py -3.12 -c "import socket, xmlrpc.client; socket.setdefaulttimeout(5); s=xmlrpc.client.ServerProxy('http://127.0.0.1:9875'); print(s.ping())"
```

Both checks must succeed before continuing.

### 5.7 Optional: install the MCP stdio server

The addon RPC is enough for this demo. To show the upstream MCP server:

```powershell
uvx freecad-mcp --help
```

Do not run `uvx freecad-mcp` as the long-running demo bridge unless a proper MCP client is available; it is a stdio MCP server, not a shell command that returns a model directly.

## 6. Recommended local bridge

The browser AI uses `exec`, so create a small stdlib bridge that sends a Python script to the FreeCAD MCP addon's XML-RPC endpoint.

Path:

```text
C:\Users\<user>\.webai-claw\skill\freecad_rpc.py
```

Conceptual helper:

```python
import argparse
import pathlib
import xmlrpc.client

parser = argparse.ArgumentParser()
parser.add_argument("--script", required=True)
parser.add_argument("--url", default="http://127.0.0.1:9875")
args = parser.parse_args()

code = pathlib.Path(args.script).read_text(encoding="utf-8")
proxy = xmlrpc.client.ServerProxy(args.url, allow_none=True)
print(proxy.execute_code(code))
```

The AI can create this helper with `write_file` during the demo. For a reliable recording, test it before recording.

Example execution:

```powershell
py -3.12 "$HOME\.webai-claw\skill\freecad_rpc.py" --script "$HOME\webai-claw-demo\build_divider.py"
```

## 6.1 Security notes for the recording

- The FreeCAD addon's `execute_code` runs arbitrary Python inside FreeCAD. Treat
  the bridge like a local automation tool, not a sandbox.
- Keep **Remote Connections** off for the demo; the RPC server stays on
  `127.0.0.1`.
- Show the generated script and ask for confirmation before executing it.
- Save the FreeCAD document before running a large generated script.
- Do not show real API keys, account details, machine UUIDs, or private paths.

## 7. English prompts for DeepSeek

Use these prompts in order. The AI should send normal text first and obtain confirmation before destructive or persistent changes.

### Prompt 1: Connect confirmation

```text
You are connected to a Windows 11 ARM64 virtual machine through webai-claw.
Confirm the host, platform, and shell. Do not run any commands yet.
```

### Prompt 2: Install FreeCAD

```text
Install FreeCAD on this Windows VM using winget. Use the exact package id
FreeCAD.FreeCAD. Accept the package and source agreements. After installation,
verify the package with winget and find the FreeCAD executable path. Report the
commands and results. Do not open FreeCAD yet.
```

### Prompt 3: Install prerequisites and the MCP addon

```text
Install Git and uv if they are missing. Clone
https://github.com/neka-nat/freecad-mcp.git into the user's home directory.
Copy only the addon\FreeCADMCP directory into
%APPDATA%\FreeCAD\v1-1\Mod\FreeCADMCP. Verify that InitGui.py exists.
Do not copy the whole repository into the Mod directory.
```

### Prompt 4: Prepare the local bridge

```text
Create a small Python bridge at ~/.webai-claw/skill/freecad_rpc.py that accepts
a --script path and sends the script contents to the FreeCAD MCP addon at
http://127.0.0.1:9875 using xmlrpc.client execute_code. Show me the script and
ask for confirmation before writing it.
```

### Prompt 5: Start and verify the RPC server

```text
I have started the FreeCAD MCP Addon workbench and clicked Start RPC Server.
Verify that 127.0.0.1:9875 is listening and that the XML-RPC ping returns true.
If it fails, diagnose the addon path and the FreeCAD Report View.
```

### Prompt 6: Create the skill

```text
Create a reusable custom skill named "freecad" in
~/webai-claw-skills/custom/AI-FREECAD.md. Use write_file. Include frontmatter
with name, description, triggers, platforms, and version. Explain how to call
the freecad_rpc.py bridge, how to create and inspect documents, how to export
STEP and STL, and the safety rules. Ask me to confirm the complete skill before
writing it.
```

### Prompt 7: Create the printable divider

```text
Use the freecad skill. Create a 3D-printable drop-in divider insert for a tin
pencil box with external dimensions 189 mm x 85 mm x 18 mm. Assume 1.5 mm sheet
thickness and 2 mm clearance per side. Use an insert footprint of 184 mm x
80 mm, height 15 mm, wall and divider thickness 1.4 mm, and bottom thickness
1.2 mm. Add one longitudinal divider at y = 40 mm and cross dividers at x = 60
mm and x = 120 mm in the back row. Create the FreeCAD document, show an
isometric screenshot, and export FCStd, STEP, and STL to
C:\Users\Public\webai-claw-demo. Report the final dimensions and file paths.
```

### Prompt 8: Validate the printable output

```text
Check the exported STL for a positive volume and reasonable bounding box.
Report the bounding box in millimeters and confirm that the STL exists.
Do not modify the model unless I ask.
```

## 8. Chinese operation flow and voiceover outline

### 0:00-1:00 开场

画面：macOS 桌面，切到 Windows 11 ARM64 虚拟机。

中文旁白：

> 这是一个在 Apple Silicon Mac 上运行的 Windows 11 ARM64 虚拟机。
> 我们会在里面安装 FreeCAD、webai-claw 和 FreeCAD MCP 控件，
> 然后让 DeepSeek 自己安装环境、创建技能，最后设计一个可打印的文具盒隔断。

字幕/画面：`FreeCAD + webai-claw + DeepSeek`。

### 1:00-2:30 安装插件与连接

画面：

1. 在 Chrome 打开 `chrome://extensions`；
2. 开启 Developer mode；
3. Load unpacked，选择 webai-claw 1.2.2 的 `extension` 目录；
4. 在 PowerShell 运行 native host 安装命令；
5. 打开 DeepSeek，点击扩展 Connect。

中文旁白：

> 这里使用 1.2.2 开发版，因为 1.1.8 商店版还没有 write_file 和技能创建能力。
> 安装 native host 后，Connect 会把 AI-AGENT 和本机配置发给 DeepSeek。

### 2:30-4:30 让 AI 安装 FreeCAD

画面：在 DeepSeek 输入 Prompt 2。

中文旁白：

> 我们不自己敲安装命令，而是让 DeepSeek 通过 webai-claw 执行。
> 它使用 winget 安装 FreeCAD，然后验证安装路径。

预期：UAC 弹窗、winget 下载、FreeCAD 安装完成。

### 4:30-7:00 安装 MCP 控件

画面：输入 Prompt 3，展示 Git clone 和复制 `FreeCADMCP`。

中文旁白：

> 这里安装的是 FreeCAD 的 MCP Addon。
> 只复制 addon/FreeCADMCP，不能把整个仓库复制进 Mod 目录。
> FreeCAD 1.1 的路径是 `%APPDATA%\FreeCAD\v1-1\Mod`。

然后手动：

1. 重启 FreeCAD；
2. 选择 MCP Addon 工作台；
3. 点击 Start RPC Server；
4. 在 PowerShell 执行 `Test-NetConnection`。

### 7:00-9:00 创建本地桥和技能

画面：输入 Prompt 4、Prompt 6。

中文旁白：

> 网页 AI 不能直接说 MCP，它通过 exec 调用本地 Python 桥。
> 这个桥把脚本发给 FreeCAD 的 RPC 端口。
> 然后我们让 DeepSeek 把这个流程保存成 custom skill。
> 它会先展示草稿，确认后才写入 `~/webai-claw-skills/custom/AI-FREECAD.md`。

画面：展示 AI 生成的 skill 文件和 SHA-256 结果。

### 9:00-13:00 使用技能设计隔断

画面：输入 Prompt 7。

中文旁白：

> 现在只给尺寸和设计要求，不再手工教 FreeCAD 命令。
> AI 读取 freecad skill，生成 FreeCAD Python 脚本，通过本地桥执行。
> 外尺寸 189 x 85 x 18 毫米，插入件按 184 x 80 x 15 毫米设计，
> 留出 2 毫米间隙，隔板 1.4 毫米，底部 1.2 毫米。
> 前侧是长笔槽，后侧分成三个小格。

画面：FreeCAD 视口、等轴测截图、导出 STEP/STL。

### 13:00-15:00 验证和打印

画面：资源管理器中的三个文件；打开 STL 查看；可选打开切片软件。

中文旁白：

> 最后检查 STL 的包围盒和体积，确认导出文件存在。
> 真正打印前，建议测量文具盒内部尺寸，按实际内宽调整 1-2 毫米间隙。

### 15:00-16:00 结尾

中文旁白：

> 这个视频展示了三件事：
> 第一，AI 可以安装本地软件；
> 第二，AI 可以通过本地 RPC/MCP 控制桌面应用；
> 第三，AI 可以把自己的工作流程保存成可复用技能。
> 以后增加新工具，只需要增加新的 skill，不需要修改插件。

## 9. Known risks

1. **ARM64 emulation**: FreeCAD x64 may start slowly or have OpenGL glitches. Test before recording.
2. **Addon path**: FreeCAD 1.1 uses `%APPDATA%\FreeCAD\v1-1\Mod`, not the old `%APPDATA%\FreeCAD\Mod`.
3. **RPC bridge**: The browser AI is not a native MCP client. The demo must use `freecad_rpc.py` or a generic MCP bridge.
4. **Skill authoring version**: Store 1.1.8 cannot create skills. Use 1.2.2 or wait for the 1.2 store release.
5. **DeepSeek variability**: Long multi-step prompts may need retries. Keep each prompt focused.
6. **Privacy**: Blur the real machine UUID, user paths, and DeepSeek account details.
7. **Fit tolerance**: The 184 x 80 mm insert is a demo assumption, not a universal fit. Recommend measuring the actual internal dimensions before printing.

## 10. Suggested video metadata

Title:

```text
Can DeepSeek Install FreeCAD and Build a 3D-Printable Organizer?
```

Description:

```text
A Windows 11 ARM64 VM demo: install FreeCAD, connect webai-claw,
create a reusable FreeCAD skill with DeepSeek, and export a 3D-printable
pencil-box divider.
```

Chapters:

```text
00:00 Intro
01:00 Install the browser bridge
02:30 Install FreeCAD with AI
04:30 Install the FreeCAD MCP addon
07:00 Create the FreeCAD skill
09:00 Design the divider insert
13:00 Validate STEP and STL
15:00 Conclusion
```
