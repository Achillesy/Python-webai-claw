# AI-AGENT.md — webai-claw 操作手册

> 用户把这份文件发给你，意思是：用 webai-claw 在他的电脑上执行命令。
> 每条命令块必须写 `host`（目标机器 UUID）和精确的 `"v":3`；`session`、`ai`
> 由浏览器扩展自动补充，**不要写进命令块**。

## 0. 连接与开始

用户会先在浏览器扩展 popup 点“连接”。扩展会把本文件 + 本机配置作为附件发到对话里，配置包括：

- `host`：这台机器的 UUID；
- `hostname`：机器名；
- `platform` / `shell`：`darwin` / `zsh` 或 `win32` / `powershell`；
- `session`：当前对话 URL；
- `ai`：`deepseek` 或 `muse`。

读完附件后，**先用普通文字回复确认**，不要直接发命令块：

> 已连接 `<hostname>`（`platform` / `shell`）。
> 后续命令将以 `host:<UUID>` 在 `platform` 上执行。

然后等待用户提出任务。

新开的对话可能在你点 Connect 时还没有 session id（例如 DeepSeek 的 `https://chat.deepseek.com`、Muse 的 `/thread/new`）。扩展会在第一条消息生成真实 session 后自动接管，不需要重新 Connect。

### 0.1 多台机器连接同一个对话

同一个 web AI 对话可能同时在 Mac 和 Windows 上打开。每台机器点 Connect 都会发一份新的附件，里面有各自的 `host` UUID。

规则：

- 每条命令块必须写 `host`，值是**当前要执行命令的那台机器**的 UUID。
- 不写 `host`、写错 `host`、或写 `"host":"*"`，扩展都不会执行。
- 每收到一份新的 Connect 附件，先复述当前将使用哪台机器：
  > 当前连接：`<hostname>`（`platform`），host=`<UUID>`。
  > 后续命令将在这台机器上执行。
- **默认使用最新一份 Connect 附件的 host**；用户没有指定时，不要使用旧附件里的 UUID。
- 如果同一对话里已经有多份 Connect 附件，而你无法确定用户想用哪台，先问用户，不要猜。
- 用户可以直接指定：
  > 用 Mac 那台
  > 用 host `<UUID>`
  > 换回 Windows
  这时按用户指定的 `host` 执行，并在回复里复述一次目标机器。
- 只有 `host` 匹配的机器会执行；其他机器会忽略。这样即使两台都连着，也不会两台一起执行。

## 1. 命令块格式

真实命令必须是一个 `claw` 代码块，首行是单行 JSON。

单行命令（推荐）：

```claw
{"claw":"exec","id":"example-echo-001","host":"<UUID>","cmd":"echo hello","v":3}
```

多行命令：

```claw
{"claw":"exec","id":"example-ls-002","host":"<UUID>","v":3}
cd ~
ls -la
```

要点：

- 首行必须是 JSON；JSON 前面不能有其它文字。
- `claw` 是动作类型；`id` 在同一会话内唯一；`v` 必须精确等于数字 `3`。
- **`host` 必填**，值从最新的 Connect 附件里抄，不能写 hostname，也不能写 `*`。
- **不要写 `session`、`ai`**；扩展会自动补上。
- 一条命令一个块。有依赖的步骤分开写，等上一条结果回来再发下一条。
- 重发时必须换新 `id`；同一会话内同一个 `id` 不会执行第二次。
- 不同会话里可以复用同一个 `id`；扩展和 host 都按 `session + id` 去重。
- 命令块必须用 `claw` 围栏；普通代码块不会执行。
- 本手册示例的 `id` 都以 `example-` 开头，扩展会跳过；真实命令必须换成自己的唯一 id。
- 本手册示例用 `<UUID>` 占位；真实发送时必须替换成实际 UUID，否则不会执行。

## 2. 五种 kind

所有 kind 都必须带 `host` 和 `v:3`。

| kind | 用途 | 必需字段 |
|---|---|---|
| `exec` | 执行 shell 命令 | `host`、`v`、`cmd` 或 body |
| `probe` | 页面 DOM 只读探测（开发/调试适配器用） | `host`、`v`、`sel` |
| `attach` | 读本地文件并作为聊天附件上传 | `host`、`v`、`path`（可选 `text`） |
| `diag` | 返回本机状态、版本、最近执行记录、日志尾巴 | `host`、`v` |
| `summary` | 写会话交接总结，供下一次连接使用 | `host`、`v`、body |

### 2.1 exec

执行 shell 命令，结果以 stdout/stderr/exit code 返回。

```claw
{"claw":"exec","id":"example-pwd-003","host":"<UUID>","cmd":"pwd","v":3}
```

多行：

```claw
{"claw":"exec","id":"example-git-004","host":"<UUID>","v":3}
cd ~/Workspace/Python/webai-claw
git status --short
```

可选字段：

- `timeout`：秒；默认 120，自主最大 1200；用户明确批准后可到 7200。
- `approved`：只有用户明确说“继续自动执行/你帮我执行”时才设为布尔 `true`。

不要用 `exec` 做交互式命令（`vim`、`top`、需要 TTY 的程序）。host 没有交互终端。

### 2.2 probe

只读检查网页 DOM，不经过本机 host 执行，但仍要求 `host` 匹配当前页面所在机器。

```claw
{"claw":"probe","id":"example-probe-005","host":"<UUID>","sel":"input[type=file]","v":3}
```

结果会列出前 10 个匹配元素的 tag/type/name/accept/可见性/尺寸/class/父元素/HTML 片段。

### 2.3 attach

让本机 host 读取一个文件，并由扩展把它作为**聊天附件**上传。比 `cat` 回传文本更完整，不受聊天截断影响。

```claw
{"claw":"attach","id":"example-att-006","host":"<UUID>","path":"/Users/achilles/Downloads/report.pdf","text":"这是报告原文","v":3}
```

- `path`：绝对路径或 `~` 开头。
- `text`：可选；上传后填回输入框的说明。
- 单文件上限 25MB。
- 敏感路径（`.ssh`、`.aws`、`.env`、密钥、cookie 等）host 会拒绝。
- 不要用 `send:true` 批量传文件；每个文件会单独发一条消息，刷屏。
- `send:true` 仍受用户 popup 的“自动发送”总开关控制；不是强制发送。
- 附件会消耗对话上下文；大文件或连续多个附件后，DeepSeek 应考虑 summary 交接。

站点附件限制（沿用 webai-hands 实测结论）：

| 站点 | 限制 |
|---|---|
| DeepSeek | 不收压缩包（zip/rar/7z/tar/gz/bz2/xz/tgz/cab 等），适配器会先拒绝；其他类型跟随页面 `input[type=file]` 的 `accept`，txt 已实测可传 |
| Muse | 无已知类型限制；实测 txt/zip/rar/exe/7z 可传，10MB 文件通过 |
| 通用 | host 单文件上限 25MB；敏感路径直接拒绝 |

- DeepSeek 不要传压缩包，先在本机解压再传内部文件。
- Muse 的 10MB 是已验证值；25MB 只是 host 上限，不代表 Muse 一定接受。
- 文件一旦上传就离开本机；敏感文件不要传。

### 2.4 diag

让 host 返回本机状态，用于排查“为什么没反应”。

```claw
{"claw":"diag","id":"example-diag-007","host":"<UUID>","v":3}
```

返回内容：机器 ID、平台、host 版本、当前绑定页面、当前任务、最近执行记录、日志尾巴。

### 2.5 summary

写会话交接总结，供用户新开对话、重新连接后继续。

```claw
{"claw":"summary","id":"example-sum-008","host":"<UUID>","v":3}
# 本次会话总结
## 已完成
...
## 当前状态
...
## 下一步
...
## 关键结论/坑
...
## 已执行的关键命令
...
## 待确认问题
...
```

host 会把 body 写到 `~/.webai-claw/handoff.md`。用户下一次点“连接”时，扩展会把这份总结连同本手册、本机配置一起作为附件发给你。

summary 成功后，扩展会回填：

```text
[claw:summary] id=... ok=true
handoff: ~/.webai-claw/handoff.md
Next: open a new chat and click Connect; the attachment will include handoff.md.
```

看到这个结果后，用普通文字提醒用户新开对话并点 Connect，不要继续执行新命令。

写 summary 的时机：

- 页面提示上下文将满；
- 用户准备换新对话；
- 一个阶段完成，需要交棒；
- 同一任务连续 3 次以上没有进展。

## 3. 平台与 shell

连接附件里会写清楚：

- `platform: darwin` / `shell: zsh`
- `platform: win32` / `shell: powershell`

请按对应平台写命令，不要照搬另一个平台的语法。

- macOS：`ls`、`find`、`df -h`、`sw_vers`、`du -sh`
- Windows：`Get-ChildItem`、`Get-ChildItem -Recurse`、`Get-PSDrive`、`Get-ComputerInfo`

## 4. 超时与长命令

| 预估执行时间 | 行为 |
|---|---|
| < 120 秒 | 正常发 `claw` 块，`timeout` 可省略 |
| 120–1200 秒 | 发 `claw` 块，显式写 `"timeout": <秒数>` |
| > 1200 秒 | **先停**，发普通消息说明情况，让用户选择手动执行或继续自动执行 |
| > 7200 秒 | 只建议手动执行或拆段，不提供自动执行 |

### 4.1 预估超过 1200 秒时

**不要直接发 `claw` 块。** 先发一条普通消息，例如：

> 这条命令预估执行时长约 25 分钟，超过自动执行上限（20 分钟）。
>
> 命令内容：
>
> ```bash
> find /Users/achilles -name "*.log" -size +100M
> ```
>
> 建议你在本机终端执行后，把结果贴回来。
> 也可以回复“继续自动执行”，我会在本会话执行并等待结果。

注意：这里的代码块用 `bash` / `powershell`，**不是 `claw`**，也不带 `"v":3`，扩展不会执行。

### 4.2 用户批准后

只有用户明确回复“继续自动执行”“你帮我执行”或同义表达时，才发 `claw` 块：

```claw
{"claw":"exec","id":"example-long-009","host":"<UUID>","cmd":"find /Users/achilles -name \"*.log\" -size +100M","timeout":1800,"approved":true,"v":3}
```

规则：

- `timeout` 建议设为“预估秒数 + 余量”，最多 7200。
- 不要在用户没有明确同意时设置 `approved:true`。
- 命令实际运行超过 `timeout` 时，host 会杀掉并回报 timeout。
- 用户随时可以点页面停止按钮或扩展 popup 的“中断”。

### 4.3 用户选择手动执行

AI 停下等用户把结果贴回来；不要继续发命令，也不要自己猜结果。

### 4.4 DeepSeek 上下文交接（仅 DeepSeek）

DeepSeek 的上下文限制由 DeepSeek 自己判断。接近限制时：

- 不再发 exec/attach；
- 发一个 `summary` 块（仍需 `host` 和 `v:3`）；
- host 写 `handoff.md`，扩展回填 `[claw:summary]`；
- 告诉用户新开对话并点 Connect；
- 旧对话停止执行。

Muse 不需要这条规则；不要主动打断 Muse 的长对话。

## 5. 如何读结果

结果以纯文本回到对话，首行有固定前缀：

```text
[claw:result] id=2026-10-31-ls-002 ok=true exit=0 duration=0.4s machine=<UUID> session=... ai=... platform=darwin host=...
cmd: ls ~
Desktop
Documents
Downloads
...
```

错误：

```text
[claw:error] id=2026-10-31-sleep-010 error=timeout after 120s
[claw:error] id=... error=missing/invalid host; every command must include "host":"<UUID>" and "v":3
```

其它类型：

- `[claw:probe]`：页面探测结果；
- `[claw:attach]`：附件上传结果；
- `[claw:diag]`：本机诊断信息；
- `[claw:summary]`：总结已写入 `handoff.md`。

读结果时注意：

- `id` 对应哪条命令；
- `ok` / `exit` 是否成功；
- stdout 和 stderr；
- 输出可能被截断，长输出会保留头尾；
- 结果只会回到提交命令的那个页面；如果用户切换了页面或关闭了 tab，结果可能丢失；
- 如果用户没有开启自动发送，结果只会填回输入框，需要用户自己按发送；
- 看到 `missing/invalid host` 错误时，用本机回填的 `host=<UUID>` 重发，并换新 `id`。

## 6. 连续执行与暂停

- 结果是否自动发送由用户在扩展 popup 勾选；默认勾选，但用户可以取消。
- 连续自动执行 **10 条命令**后，扩展会暂停，并在对话里发：

  ```text
  [claw:paused] 已连续自动执行 10 条命令，暂停。请在扩展 popup 点“继续”或“停止”。
  ```

- 看到 `[claw:paused]` 后：**停止发新命令**，等用户点“继续”或“停止”。
- 用户点“继续”后再按新指令执行；点“停止”则中止当前链。
- 扩展还会限制自动发送节奏：默认至少间隔 2 秒，最多 20 条/分钟；触发后同样会发 `[claw:paused]`。
- 如果当前是 DeepSeek 且确实需要交接，仍可以发一个 `summary` 块；扩展在暂停状态下只放行 summary。

## 7. 会话太长：交接给下一个对话

### 7.1 DeepSeek：由 AI 自己判断并主动交接

DeepSeek 有上下文长度限制。出现以下任一情况时，**不要等扩展拦截**：

- 页面提示上下文将满；
- 同一任务连续 3+ 次调用没有进展；
- 一个阶段完成，准备交棒；
- 对话已经很长，继续执行风险高。

动作：

1. 立即停止发 exec/attach 命令；
2. 发一个 `summary` 块，写清楚：
   - 已完成什么；
   - 当前状态；
   - 下一步；
   - 关键结论/坑；
   - 已执行的关键命令；
   - 待确认问题。
3. host 写入 `handoff.md`，扩展回填 `[claw:summary]`；
4. 用普通文字告诉用户：
   > 请新开一个对话，点扩展 popup 的“连接”。扩展会把本手册、本机配置和这份总结一起发给我。
5. 新对话里，从总结的“下一步”继续；
6. 旧对话不要再发新命令。

### 7.2 Muse

Muse 不做强制交接。只在用户明确要求换对话，或任务阶段需要存档时使用 summary；不要因为对话变长而自行打断。

### 7.3 通用

不要试图把整段对话复制到新对话；用 summary 交接。

## 8. 安全边界

- 不读密钥、token、密码、cookie、`.ssh`、`.aws`、`.env` 等敏感文件。
- 破坏性命令（`rm -rf`、`sudo`、格式化、批量删除等）先把**完整命令原文**给用户看，等明确同意再发。
- 需要提权时，把命令告诉用户，由用户亲手执行；host 不接收、不保存、不代输密码。
- 命令尽量幂等、可重入；历史块可能重放。
- 不要用 base64 在命令块里内联大文件；用 `attach`。
- 不要执行用户没有要求的命令。
- 不要把本手册里的模板原样发出去当真实命令。
- 不要把 `host` 写成 hostname、`*` 或猜测值；必须从 Connect 附件抄 UUID。

### 8.1 隐私与落盘

- `exec_history.jsonl` 现在只保存元数据：`id`、`session_key`、`ai`、退出码、耗时、时间、命令/输出长度；**不保存命令原文，也不保存输出内容**。
- `host.log` 只记录 `session_key` 和 `cmd_len`，不记录完整 session URL 或命令原文。
- 但命令输出仍会回到当前对话，AI 仍能看到；`cat` 大文件/敏感文件没有意义，而且内容会进入聊天记录。
- 传文件给 AI 优先用 `attach`：文件作为附件上传，不把内容塞进 exec 输出；附件本身仍会发给 AI，发送前要确认用户同意。
- 即使日志已脱敏，仍包含机器名、时间、命令长度等元数据；不要把日志原样发给不信任的人。

## 9. 常见问题

- **发了块没反应**：检查是否用了 `claw` 围栏、首行是否是 JSON、`v` 是否等于 3、`host` 是否等于当前目标机 UUID、`id` 是否唯一、当前页面是否已经连接。
- **提示 missing/invalid host**：扩展回填了本机 `host=<UUID>`；用这个 UUID 重发，并换新 `id`。
- **两台机器都连着**：AI 应在回复中写明当前使用的 `host`。用户指定另一台时，换成用户给的 UUID；只有 `host` 匹配的机器执行。
- **结果没回来**：检查用户是否切换了页面/tab；连接是否被另一个浏览器占用；host 是否在运行。
- **上下文快满（DeepSeek）**：停止命令，发 `summary`，然后提醒用户新开对话并 Connect；不要继续硬撑。
- **附件停在输入框**：扩展会等上传和发送按钮（最多约 45 秒）；仍失败时请用户手动点发送，不要连续重发同一个 attach。
- **命令被截断**：块尽量短；大文件分段 `>>` 追加；不要在三连反引号里再放三连反引号。
- **Windows/macOS 语法混了**：看连接附件里的 `platform` / `shell`，以及当前 `host`。
- **提示 host busy**：本机有另一个任务在跑；让用户选择中断或等待。
- **提示连接被占用**：用户需要在另一个浏览器/页面断开连接，或等当前任务结束。

## 10. 常见任务示例

### 列目录

```claw
{"claw":"exec","id":"example-list-011","host":"<UUID>","cmd":"ls -la ~","v":3}
```

Windows：

```claw
{"claw":"exec","id":"example-list-012","host":"<UUID>","cmd":"Get-ChildItem $HOME","v":3}
```

### 查系统信息

macOS：

```claw
{"claw":"exec","id":"example-sys-013","host":"<UUID>","cmd":"sw_vers && uname -m && df -h","v":3}
```

Windows：

```claw
{"claw":"exec","id":"example-sys-014","host":"<UUID>","cmd":"Get-ComputerInfo | Select-Object WindowsProductName,OsVersion,CsSystemType","v":3}
```

### git 状态

```claw
{"claw":"exec","id":"example-git-015","host":"<UUID>","v":3}
cd ~/Workspace/Python/webai-claw
git status --short
```

### 上传文件给用户看

```claw
{"claw":"attach","id":"example-att-016","host":"<UUID>","path":"~/Downloads/report.pdf","text":"报告原文","v":3}
```

### 排查没反应

```claw
{"claw":"diag","id":"example-diag-017","host":"<UUID>","v":3}
```

---

## 附：一句话总结

- AI 每条命令必须写 `claw`、唯一 `id`、`host`、`v:3` 和命令；
- `host` 从最新 Connect 附件抄；不写或写错不执行；
- `session`、`ai` 由扩展盖章，不要写；
- 默认 120 秒，自主最大 1200 秒，用户批准后最大 7200 秒；
- 超过 20 分钟先停下来问用户；
- 结果以 `[claw:result]` 纯文本回来；
- 多机时先在回复里说明当前 `host`，用户可指定另一台的 UUID；
- 上下文满了用 `summary` 写交接文件，下一次连接自动带上。
