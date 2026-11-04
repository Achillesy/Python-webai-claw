# FreeCAD + webai-claw demo plan

Status: macOS-native recording plan. Target: 8-9 silent screen-recording clips,
each under 3 minutes, with Chinese voiceover and English subtitles added in
post-production.

## 1. Decision

Record on the **Mac mini M1 directly**, not in a Windows ARM64 VM.

Reasons:

- FreeCAD has a native macOS ARM64 build;
- no x64 emulation or VM GPU issues;
- Chrome/Edge and the native host run natively on the same machine;
- screen recording, cursor control, and file inspection are simpler;
- the resulting demo is shorter and more reliable.

Use the **webai-claw 1.2.5 development build** for this recording. The 1.1.8
store build does not have `write_file`, custom skill authoring, or the skill
index required by this demo.

## 2. Feasibility assessment

| Item | Assessment |
| --- | --- |
| macOS M1 native | High confidence |
| FreeCAD ARM64 | Native build available |
| FreeCAD MCP addon | Supports FreeCAD 1.0/1.1 and exposes local XML-RPC on `127.0.0.1:9875` |
| webai-claw 1.2.5 | Required for `write_file` and custom skill creation |
| DeepSeek web | Existing adapter works |
| AI-created skill | Feasible: `write_file` writes `custom/AI-FREECAD.md`; the host validates frontmatter |
| MCP protocol | The demo uses the FreeCAD MCP addon's local RPC endpoint through a small Python bridge; the browser AI is not a native MCP client |
| 3D-printable output | Feasible with FCStd, STEP, and STL export |

The one caveat to state on camera: the browser AI cannot speak MCP directly.
It uses `exec` to call a local Python helper, which calls the FreeCAD MCP
addon's RPC endpoint. This is still the FreeCAD MCP integration, but not a
direct browser-to-MCP connection.

## 3. Target object

A 3D-printable drop-in divider insert for a tin pencil box.

External dimensions:

```text
189 mm x 85 mm x 18 mm
```

Demo assumptions:

- Sheet thickness: 1.5 mm.
- Insert clearance: 2.0 mm per side.
- Insert outer footprint: **184 mm x 80 mm**.
- Insert height: **15 mm**.
- Wall and divider thickness: **1.4 mm**.
- Bottom thickness: **1.2 mm**.
- One longitudinal divider at y = 40 mm.
- Two cross dividers in the back row at x = 60 mm and x = 120 mm.
- Result: one long front compartment and three back compartments.
- Output directory: `~/webai-claw-demo/`.
- Output files: `pencil-box-divider.FCStd`, `.step`, `.stl`.

The video must state that these are demo assumptions, not a universal fit.
Recommend measuring the actual internal dimensions before a production print.

## 4. Environment and prerequisites

- macOS on Apple Silicon.
- Chrome or Edge.
- Python 3 for the native host and bridge.
- Git.
- FreeCAD 1.1.x macOS ARM64.
- webai-claw 1.2.5 unpacked extension and native host.
- DeepSeek web chat.
- Screen recorder that can record a window or screen at 1080p.
- Microphone muted during recording; voiceover added later.

Optional:

- Homebrew for installing FreeCAD and tools.
- `uv` / `uvx` if you also want to inspect the upstream MCP stdio server.

### 4.1 Pre-recording checklist

- [ ] `python3 --version`
- [ ] `git --version`
- [ ] `brew --version` (or install Homebrew)
- [ ] FreeCAD launches and displays a 3D viewport.
- [ ] FreeCAD MCP Addon workbench is visible.
- [ ] `nc -vz 127.0.0.1 9875` succeeds after starting the RPC server.
- [ ] webai-claw Connect works in Chrome/Edge on this Mac.
- [ ] DeepSeek can execute a test `exec` block.
- [ ] `~/webai-claw-demo/` exists.
- [ ] The desktop is clean; personal paths and machine UUID are hidden or
      blurred.
- [ ] Each planned clip has been rehearsed and is under 3 minutes.

## 5. macOS commands

### 5.1 Verify the environment

```bash
sw_vers
uname -m
python3 --version
git --version
brew --version
```

Expected: macOS on `arm64` and a working Python 3.

If Homebrew is missing:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### 5.2 Clone the demo source and install the native host

```bash
REPO="$HOME/webai-claw-demo-src"
rm -rf "$REPO"
git clone --depth 1 https://github.com/Achillesy/Python-webai-claw.git "$REPO"
python3 "$REPO/native-host/install.py"
```

This installs the native host and registers native-messaging manifests for
Chrome and Edge. It also installs the visible skill library under
`~/webai-claw-skills/`.

### 5.3 Load the extension

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select:
   ```text
   ~/webai-claw-demo-src/extension
   ```
5. Confirm the popup shows extension `v1.2.5` and host `v1.2.5`.

The development key keeps the extension ID stable and allowlisted by the
installer. Do not use the 1.1.8 store build for this demo.

### 5.4 Create the demo directory

```bash
mkdir -p "$HOME/webai-claw-demo"
```

Using the home directory avoids macOS TCC prompts for Desktop, Documents, and
Downloads. If you choose a protected folder, grant Full Disk Access to the
browser that launches the native host.

### 5.5 Install FreeCAD

```bash
brew install --cask freecad
open -a FreeCAD
```

Verify:

```bash
ls -d /Applications/FreeCAD.app
```

FreeCAD 1.1 on macOS uses this addon root:

```text
~/Library/Application Support/FreeCAD/v1-1/Mod/
```

### 5.6 Install the FreeCAD MCP addon

```bash
MCP_REPO="$HOME/freecad-mcp"
rm -rf "$MCP_REPO"
git clone --depth 1 https://github.com/neka-nat/freecad-mcp.git "$MCP_REPO"

mkdir -p "$HOME/Library/Application Support/FreeCAD/v1-1/Mod"
cp -R "$MCP_REPO/addon/FreeCADMCP" \
  "$HOME/Library/Application Support/FreeCAD/v1-1/Mod/FreeCADMCP"
```

Verify:

```bash
test -f "$HOME/Library/Application Support/FreeCAD/v1-1/Mod/FreeCADMCP/InitGui.py" && echo OK
```

Do not copy the whole repository into `Mod`, and do not create a second
`FreeCADMCP` directory level.

### 5.7 Start and verify the RPC server

Restart FreeCAD, then:

1. Select **MCP Addon** in the workbench selector.
2. Click **Start RPC Server** in the **FreeCAD MCP** toolbar.
3. Confirm the Report View shows `127.0.0.1:9875`.

Verify from Terminal:

```bash
nc -vz 127.0.0.1 9875
python3 -c "import xmlrpc.client; print(xmlrpc.client.ServerProxy('http://127.0.0.1:9875').ping())"
```

Both checks must succeed before continuing.

### 5.8 Optional: inspect the MCP stdio server

The addon RPC endpoint is sufficient for this demo. To show the upstream MCP
server:

```bash
brew install uv
uvx freecad-mcp --help
```

Do not run `uvx freecad-mcp` as the demo bridge unless a proper MCP client is
available; it is a stdio MCP server, not a command that returns a model directly.

## 6. Local bridge

The browser AI uses `exec`, so create a small Python bridge that sends a script
to the FreeCAD MCP addon's XML-RPC endpoint.

Path:

```text
~/.webai-claw/skill/freecad_rpc.py
```

Reference implementation:

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

The AI can create this helper with `write_file` during the demo. Test it before
recording:

```bash
python3 "$HOME/.webai-claw/skill/freecad_rpc.py" \
  --script "$HOME/webai-claw-demo/smoke_test.py"
```

A smoke test can simply print `FreeCAD.ActiveDocument` or create a document.
Do not show a failed bridge attempt in the final edit.

### 6.1 Security notes

- `execute_code` runs arbitrary Python inside FreeCAD. Treat the bridge as a
  local automation tool, not a sandbox.
- Keep **Remote Connections** off; the RPC server stays on `127.0.0.1`.
- Show the generated script and ask for confirmation before executing it.
- Save the FreeCAD document before running a large generated script.
- Do not show API keys, account details, machine UUIDs, or private paths.

## 7. English prompts for DeepSeek

Use these in order. Split long instructions into separate prompts and use
natural-language confirmation before persistent changes.

### Prompt 1: Connect confirmation

```text
You are connected to a macOS Apple Silicon machine through webai-claw.
Confirm the host, platform, and shell. Do not run any commands yet.
```

### Prompt 2: Install FreeCAD

```text
Install FreeCAD on this Mac with Homebrew using: brew install --cask freecad
The actual command must include host and "v":3. After installation, verify that
/Applications/FreeCAD.app exists and report the result. Do not open FreeCAD yet.
```

### Prompt 3: Install the FreeCAD MCP addon

```text
Clone https://github.com/neka-nat/freecad-mcp.git into your home directory.
Copy only addon/FreeCADMCP into:
~/Library/Application Support/FreeCAD/v1-1/Mod/FreeCADMCP
Verify that InitGui.py exists. Do not copy the whole repository into Mod.
```

### Prompt 4: Create the local RPC bridge

```text
Create a Python bridge at ~/.webai-claw/skill/freecad_rpc.py. It must accept a
--script path, read the file as UTF-8, and send the code to the FreeCAD XML-RPC
endpoint at http://127.0.0.1:9875 using xmlrpc.client execute_code. Show me the
full script and ask for confirmation before writing it.
```

### Prompt 5: Verify the RPC server

```text
I have opened FreeCAD, selected the MCP Addon workbench, and clicked Start RPC
Server. Verify that 127.0.0.1:9875 is listening and that the XML-RPC ping
returns true. If it fails, diagnose the addon path and the FreeCAD Report View.
```

### Prompt 6: Create the FreeCAD skill

```text
Create a reusable custom skill named "freecad" in
~/webai-claw-skills/custom/AI-FREECAD.md. Use write_file. Include frontmatter
with name, description, triggers, platforms, and version. Explain how to call
freecad_rpc.py, how to create and inspect documents, how to export STEP and STL,
and the safety rules. Ask me to confirm the complete skill before writing it.
```

### Prompt 7: Build the divider insert

```text
Use the freecad skill. Create a 3D-printable drop-in divider insert for a tin
pencil box with external dimensions 189 mm x 85 mm x 18 mm. Assume 1.5 mm sheet
thickness and 2 mm clearance per side. Use an insert footprint of 184 mm x
80 mm, height 15 mm, wall and divider thickness 1.4 mm, and bottom thickness
1.2 mm. Add one longitudinal divider at y = 40 mm and cross dividers at x = 60
mm and x = 120 mm in the back row. Create the FreeCAD document, show an
isometric view, and export FCStd, STEP, and STL to ~/webai-claw-demo. Report the
final bounding box and file paths.
```

### Prompt 8: Validate the printable output

```text
Check the exported STL for a positive volume and a reasonable bounding box.
Report the bounding box in millimeters and confirm that the STL exists. Do not
modify the model unless I ask.
```

## 8. Silent multi-clip plan

Record screen video only. Keep the microphone off. Add Chinese voiceover and
English subtitles after editing. Each clip must be shorter than 3:00; target
2:00-2:40 unless noted.

Use a title card at the start of each clip and a short freeze at the end.

### Clip 1: Introduction (under 1:30)

On-screen text:

```text
FreeCAD + webai-claw + DeepSeek
macOS Apple Silicon
```

Screen:

- macOS desktop;
- FreeCAD icon;
- webai-claw popup;
- DeepSeek chat tab.

Post voiceover topic:

> 在 Mac mini M1 上，让 DeepSeek 安装 FreeCAD、创建技能，并设计一个可 3D 打印的文具盒隔断。

### Clip 2: Install the extension and host (under 2:40)

Screen:

- open Chrome/Edge extensions page;
- Developer mode;
- Load unpacked;
- show `extension` folder;
- Terminal: run `install.py`;
- show popup extension/host version.

On-screen labels:

```text
Load unpacked: webai-claw/extension
Install native host
```

Post voiceover topic:

> 这里使用 1.2.5 开发版，因为商店 1.1.8 还不支持 write_file 和技能创建。

### Clip 3: Connect DeepSeek (under 2:00)

Screen:

- open DeepSeek;
- click Connect;
- show connection attachment and short note;
- show AI's host/platform confirmation.

On-screen label:

```text
Connect -> host confirmation
```

Post voiceover topic:

> Connect 后，DeepSeek 知道当前是 macOS ARM64，以及本机 UUID。

### Clip 4: Install FreeCAD (under 2:20)

Screen:

- DeepSeek prompt 2;
- command `brew install --cask freecad`;
- Homebrew progress, shortened with a jump cut;
- `ls -d /Applications/FreeCAD.app`;
- `open -a FreeCAD`.

Post voiceover topic:

> 安装命令由 DeepSeek 通过 webai-claw 执行，用户只负责确认。

### Clip 5: Install MCP addon and start RPC (under 2:50)

Screen:

- DeepSeek prompt 3;
- Git clone and copy to `v1-1/Mod`;
- show `InitGui.py`;
- restart FreeCAD;
- select MCP Addon;
- click Start RPC Server;
- run `nc -vz 127.0.0.1 9875` and the XML-RPC ping.

Post voiceover topic:

> 这是 FreeCAD 的 MCP Addon，不是把整个仓库复制到 Mod 目录。

### Clip 6: Create the bridge and skill (under 2:50)

Screen:

- DeepSeek prompt 4;
- show `freecad_rpc.py` draft and confirm;
- DeepSeek prompt 6;
- show `AI-FREECAD.md` draft and confirm;
- show `~/webai-claw-skills/custom/AI-FREECAD.md`;
- show SHA-256/backup result if overwriting.

Post voiceover topic:

> 网页 AI 通过 exec 调用本地桥，再调用 FreeCAD 的 RPC 端口。技能保存在 custom 目录。

### Clip 7: Design the divider (under 2:50)

Screen:

- DeepSeek prompt 7;
- AI writes a FreeCAD Python script;
- bridge executes it;
- FreeCAD viewport shows the insert;
- show isometric screenshot.

On-screen labels:

```text
189 x 85 x 18 mm external
184 x 80 x 15 mm insert
1.4 mm walls / 1.2 mm bottom
```

Post voiceover topic:

> 前侧是长笔槽，后侧分成三个小格；尺寸和间隙都在提示词中明确给出。

### Clip 8: Export and validate (under 2:20)

Screen:

- show output folder `~/webai-claw-demo`;
- show `FCStd`, `STEP`, `STL`;
- open STL in a viewer or slicer;
- show bounding box/volume check.

Post voiceover topic:

> 检查 STL 包围盒和体积；实际打印前应测量文具盒内部尺寸。

### Clip 9: Closing (under 1:00)

Screen:

- summary card.

On-screen text:

```text
AI installs the tool.
AI uses the local bridge.
AI saves the workflow as a skill.
```

Post voiceover topic:

> 新增工具只需要新增 skill，不需要修改插件。

## 9. Recording and editing rules

- Record each clip separately; never rely on one continuous take.
- Keep the microphone muted; use system sounds only if useful.
- Use 1080p at 30 or 60 fps.
- Use a large cursor and a clean desktop.
- Hide personal paths, UUIDs, account names, and notification banners.
- Use jump cuts for long `brew` or Git operations.
- Add English text callouts during editing; do not speak during recording.
- Add Chinese voiceover after the cut is locked.
- Add English subtitles for international viewers.
- Keep each final clip under 3:00. If a clip runs long, split it rather than
  speeding up critical UI steps.

## 10. Known risks

1. **Development build**: 1.2.5 is required; 1.1.8 lacks `write_file` and skill
   authoring.
2. **Addon path**: FreeCAD 1.1 uses
   `~/Library/Application Support/FreeCAD/v1-1/Mod`, not an unversioned path.
3. **RPC bridge**: the browser AI is not a native MCP client; the skill uses
   the addon RPC through `freecad_rpc.py`.
4. **GUI steps**: starting the MCP Addon and RPC server requires manual clicks;
   the AI cannot click the FreeCAD UI.
5. **TCC**: keep the output in `~/webai-claw-demo` to avoid protected-folder
   prompts. If using Documents/Desktop, grant Full Disk Access to Chrome/Edge.
6. **DeepSeek variability**: split long instructions and verify each step.
7. **Fit tolerance**: 184 x 80 mm is a demo footprint; measure the real tin
   before printing.

## 11. Suggested metadata

Title:

```text
Can DeepSeek Install FreeCAD and Build a 3D-Printable Organizer?
```

Description:

```text
A macOS Apple Silicon demo: install FreeCAD, connect webai-claw, create a
reusable FreeCAD skill with DeepSeek, and export a 3D-printable pencil-box
divider.
```

Playlist chapters:

```text
Clip 1  Introduction
Clip 2  Install webai-claw
Clip 3  Connect DeepSeek
Clip 4  Install FreeCAD
Clip 5  Install the MCP addon
Clip 6  Create the FreeCAD skill
Clip 7  Design the divider
Clip 8  Export and validate
Clip 9  Closing
```
