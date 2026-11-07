# webai-claw

[English](README.md)

给网页 AI 一双手，在你自己的电脑上干活。webai-claw 把聊天里的请求变成
一条本机命令，在你的电脑上执行，再把结果发回对话里。

支持的 AI 对话站点：**DeepSeek**（`chat.deepseek.com`）和 **Muse**
（`muse.ai`）。

## 能做什么

- 在网页 AI 对话里，直接在 macOS 或 Windows 上运行 shell 命令。
- 把命令输出发回同一个对话。
- AI 需要时，把本机文件作为真正的聊天附件上传。
- 用 `write_file` 原子地创建或替换小的本机文件，带备份和哈希校验。
  大文件请用 `write_file` + `exec` 走本机生成/转换脚本，不要分块追加。
- 通过本机 API 驱动 Blender 这类本地应用。
- 从 `~/webai-claw-skills/` 发现用户可扩展的 skill，不用改扩展。
- 同一个对话在多台电脑上打开时，执行目标要明确写出来。

不用 API 密钥，也没有开发者运营的中转服务器。扩展通过 Chrome Native
Messaging 和本机 Python host 通信。host 不监听任何网络端口。

## 系统要求

- Google Chrome（桌面版）。
- macOS 或 Windows。
- 要跑命令的那台机器上装有 Python 3.9 或更新版本。
- 本机 host 只需安装一次。

Chrome 扩展只是浏览器这一半。本机 host 要在每台机器上单独安装。

### macOS 权限

macOS 用 TCC 保护桌面、文稿和下载。host 是浏览器启动的，不是终端
启动的，所以需要用到这些文件夹时，请给 Google Chrome 或 Microsoft Edge
开“完全磁盘访问权限”。改完设置后退出浏览器再重新打开。
只给终端授权对浏览器启动的 host 不起作用，`sudo`/`chmod` 也绕不过 TCC。

## 安装

### 1. 安装本机 host

macOS：

```bash
curl -fsSL https://gitee.com/achillesy/Python-webai-claw/raw/master/native-host/install.py | python3
```

Windows PowerShell：

```powershell
py -3 -c "import urllib.request; exec(urllib.request.urlopen('https://gitee.com/achillesy/Python-webai-claw/raw/master/native-host/install.py').read())"
```

> **还没有装 Python？**如果命令提示找不到 `python3` / `py`，请先装好
> Python，再重新运行上面的命令。Windows：Microsoft Store → 搜索 "Python"，
> 或在 PowerShell 里运行 `winget install Python.Python.3.13`。
> macOS：运行 `xcode-select --install`（命令行工具里包含 Python 3），或
> 从 [python.org](https://www.python.org/downloads/) 下载。

安装器会创建 `~/.webai-claw/`（放 host 程序和运行时文件）和
`~/webai-claw-skills/`（放用户能看到的操作指南），并在 Chrome 里登记
Native Messaging host。它是幂等的，重新运行就是更新 host 和指南。安装器
还会用运行它的那个 Python 创建一个私有的虚拟环境
（`~/.webai-claw/.venv`），这样即使以后系统 Python 变了，host 仍跑在
原来的解释器上；重装时已有的虚拟环境不会被替换。

### 扩展 skill

`~/webai-claw-skills/` 是一个看得见的 skill 库。根目录的预设包括
`AI-BLENDER.md`、`AI-MACOS.md` 和 `AI-WIN.md`；用户自己的 skill 放在
`custom/` 里。host 在 Connect 时生成一份只有元数据的 skill 索引，AI 只在
需要时才用 `exec` 去读对应的 skill。AI 可以把确认过的工作流用
`write_file` 保存为自定义 skill，不用改扩展、不用手动上传。自定义 skill
的 `name` 如果和预设相同，会覆盖预设（索引里会在 `overrides` 中记录被
覆盖的预设）。用
`python3 ~/.webai-claw/skill_check.py --check <file>`（整个库用 `--library`）
先验证 skill 再用；升级 host 之后，用 `python3 native-host/install.py
--verify` 检查已安装的 host、manifest、机器 ID 和 skill 目录，什么都不改。

### 2. 安装扩展

装 Chrome 应用商店的版本（如果已有），或为开发加载未打包的扩展：

1. 打开 `chrome://extensions`。
2. 打开**开发者模式**。
3. 点**加载已解压的扩展程序**，选择 `extension/` 目录。

### 3. 连接

1. 打开一个支持的 AI 对话。
2. 点 webai-claw 工具栏图标。
3. 点 **Connect**。
4. 扩展会把 `AI-AGENT.md` 和本机配置上传到对话里。

AI 会确认目标机器。每个命令块都必须包含机器 UUID 和准确的 `"v":3`。

## 弹出窗口选项

- **Auto-send command results**（默认开启）：把命令输出自动发回对话。
- **Auto-send attachments**（默认关闭）：自动发送 AI 请求的文件。
  关闭时，这些文件会留在输入框里，等你手动点发送。
- **Connect** 握手总会自动发送，因为它是建立连接的明确动作；上面两个
  设置对它不适用。
- 自动发送结果至少间隔 500 毫秒。没有固定的轮次上限；任务什么时候停，
  由 AI 操作者负责。
- **Interrupt** 停止当前命令和正在进行的链条。**Disconnect** 释放机器绑定。
- **Advanced** 里有机器 UUID（用于多台机器之间切换）和 **Test Bridge** 诊断。

工具栏角标特意保持极简：

- 没有标记：未连接；
- `✓`：已连接；
- `...`：本机 host 已连续跑一条命令 5 秒。

## 协议与设计

- [协议 v3](docs/PROTOCOL.md)
- [协议 v3 JSON Schema](protocol/v3.schema.json)
- [AI-AGENT 示例](docs/AI-AGENT-EXAMPLES.md)
- [架构](docs/ARCHITECTURE.md)
- [交互图（Mermaid）](docs/UML.md)
- [参与贡献](docs/CONTRIBUTING.md)
- [隐私](PRIVACY.md)
- [更新日志](docs/CHANGELOG.md)
- [1.2 路线图](docs/ROADMAP-1.2.md)
- [FreeCAD 演示计划](docs/DEMO-FREECAD.md)

AI 操作者指南是 [AI-AGENT.md](AI-AGENT.md)。安装后的副本在
`~/webai-claw-skills/` 里；Connect 时会自动附上 `AI-AGENT.md` 和一份 skill
索引。这个文件夹同时也是用户可扩展的 skill 库：在 `custom/` 下加一个
`.md` skill，下次 Connect 的索引里就会出现，不用改扩展。做 Blender 相关
工作时，让 AI 使用 Blender skill。

## 安全

- host 只为已连接的页面和匹配的机器 UUID 执行命令。
- `.ssh`、`.aws`、`.env`、私钥、浏览器 cookie 这类敏感路径，文件上传时
  会被拒绝。
- AI 操作者指南要求：破坏性命令执行前必须经过用户明确确认。
- host 不会提示、保存或代填密码。不要把密码放进命令里。
- 命令输出和上传的文件还是会发到你用的 AI 站点。发送敏感内容前请先检查。

数据流向见 [PRIVACY.md](PRIVACY.md)。

## 赞助

webai-claw 是免费的。如果它帮你省了时间，请作者喝杯咖啡：

- [Ko-fi](https://ko-fi.com/achillesy)
- [PayPal](https://paypal.me/achillesnewman)

国内用户也可扫码赞助：

| 微信 | 支付宝 |
|---|---|
| ![](sponsor/wechat.jpg) | ![](sponsor/alipay.jpg) |

赞助完全自愿，不影响任何功能。

## 许可

webai-claw 非商业许可。见 [LICENSE](LICENSE)。
