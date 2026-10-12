# webai-claw（中文）

给网页版 AI 长出爪子——把问答变成产出。

webai-claw = Chrome 扩展 + 本地 Python host。你照常和网页 AI（ChatGPT、Claude、
DeepSeek……）聊天；当 AI 需要在你的电脑上**动手**时，它写一个 `claw-exec` 代码块，
扩展抓取，本机 host 执行命令，结果回填到对话里。

```claw-exec
{"claw":"exec","id":"demo-1","v":3,"host":"<本机UUID>","cmd":"echo hello"}
```

免 API Key。你本来就在用的 AI 当大脑，你的电脑当它的手。

## 工作原理

1. **扩展**——content script 在支持的 AI 对话页抓取 `claw-exec` 块，
   background service worker 去重、路由。
2. **Native host**——通过 Chrome Native Messaging 注册的 Python 程序，执行命令
   并把结果流式送回。
3. **安装器**——`native-host/install.py` 按机器装好一切（`~/.webai-claw/`、
   Chrome 注册、操作指南）。

协议见 [`docs/PROTOCOL.md`](docs/PROTOCOL.md)（v3），设计见 [`docs/DESIGN.md`](docs/DESIGN.md)。

## 快速开始

```bash
# 1. 安装 host（macOS / Windows）
python3 native-host/install.py

# 2. 加载扩展
#    chrome://extensions → 开发者模式 → 加载已解压的扩展 → extension/

# 3. 在工具栏图标里看到本机 UUID，然后教 AI 干活：
#    把 ~/.webai-claw/AI-GUIDE.md 上传给任意网页 AI，让它跑一句 "echo hello"。
```

## 和 webai-hands 的关系

webai-claw 是 [webai-hands](https://github.com/Achillesy/Python-webai-hands)
的重命名升级，从底层重写（见 [`docs/ORIGIN.md`](docs/ORIGIN.md)）。两者共存：
v2 的块（`` `muse-exec ``）永远不会触发 webai-claw，v3 的块（`` `claw-exec ``）
也永远不会触发 webai-hands。

## 许可证

webai-claw Noncommercial License，见 [LICENSE](LICENSE)。
