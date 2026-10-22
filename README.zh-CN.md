<p align="center"><a href="README.md">English</a> · <a href="README.ko.md">한국어</a> · <b>简体中文</b></p>

<p align="center">
  <img src="docs/images/hero.png" alt="Acard - 可以在本地运行的开源 Notion" width="100%">
</p>

<p align="center">
  <b>Acard 是一个可以在本地运行的开源 Notion。</b><br>
  用快速的编辑器管理页面、块和数据库，一台放在你自己电脑或内网里的小服务器就能承载全部内容。
</p>

<p align="center">
  <a href="docs/install-server.md">安装服务器</a> ·
  <a href="docs/install-client.md">连接设备</a> ·
  <a href="https://github.com/Hakubisual/open-notion-acard/releases/latest">下载桌面应用</a> ·
  <a href="docs/why-acard.zh-CN.md">为什么选 Acard</a> ·
  <a href="docs/architecture.md">架构（英文）</a>
</p>

---

## 这是什么

Acard 是一个自托管的 Notion 风格工作区。一个 Bun 进程提供编辑器，把所有内容存进同一个数据文件夹里的 SQLite 文件，
并响应浏览器、Acard Local 桌面应用和你自己的 AI 智能体。除非你主动开启云端功能，数据不会离开你的设备。

既可以一个人在笔记本上用，也可以把服务器放在办公室局域网、家庭实验室或 VPN 里，供团队共同使用。

## 为什么选 Acard

| | Acard | Notion | Obsidian |
| --- | --- | --- | --- |
| 数据存放位置 | 你选定文件夹里的 SQLite 文件 | Notion 云端 | 本地仓库（vault）里的 Markdown 文件 |
| 为团队自建服务器 | 可以：一个进程，MIT 许可 | 不可以 | 没有内置（共享仓库需使用 Obsidian Sync） |
| 块编辑与数据库 | 支持：7 种视图、关联、汇总、公式 | 支持 | Markdown 笔记，Bases 提供数据库视图 |
| AI 智能体读写页面 | 你的服务器内置 MCP 与 REST | Notion API 与托管 MCP（在 Notion 云端） | 社区插件 |
| 源代码 | 开源（MIT） | 闭源 | 应用闭源，插件 API 开放 |

Notion 和 Obsidian 都是优秀的工具。Acard 适合想要 Notion 式块与数据库编辑、又不想把文档交给托管服务的人。
每一项都附有代码依据的完整对比见 [docs/why-acard.zh-CN.md](docs/why-acard.zh-CN.md)。

## 截图

| 桌面端 | 移动端 |
| --- | --- |
| <img src="docs/images/screenshot-desktop.png" alt="桌面浏览器中的编辑器" width="640"> | <img src="docs/images/screenshot-mobile.png" alt="手机上的编辑器" width="220"> |

<p align="center"><img src="docs/images/screenshot-connect.png" alt="Acard Local 桌面应用：连接服务器" width="560"></p>

## 工作原理

```mermaid
flowchart LR
  subgraph Clients
    B[Browser<br/>editor + reader]
    D[Acard Local<br/>desktop app]
    A[Your agents<br/>MCP / REST]
  end
  subgraph Server["One Bun process (local/main.ts)"]
    C["Core worker<br/>gate/_worker.js"]
    M["MCP endpoint /mcp<br/>agents/mcp-tools.ts"]
    L["Live feed /api/live"]
  end
  subgraph Data["Data folder (ACARD_DATA_DIR)"]
    S[(acard.sqlite<br/>pages, blocks, databases)]
    K[(media.sqlite<br/>images, files)]
    Z[backups/*.zip<br/>tables + media + Markdown]
  end
  B --> C
  D --> C
  A --> M --> C
  C --> S
  C --> K
  C -. change notices .-> L -. refresh .-> B
  S --> Z
```

块与数据库模型、同步与备份的详细说明见 [docs/architecture.md](docs/architecture.md)（英文）。

## 功能

- **块编辑器**：标题 1-4（均可折叠）、列表、待办、折叠块、引用、标注、代码、表格、公式、图片和嵌入。支持 `/` 命令和 Markdown 快捷输入。
- **分栏**：把块并排放进 2-4 栏，可拖动、可调宽度。
- **块颜色**、标注图标，以及能新增数据库行的**按钮**。
- **页面外观**：表情或上传的图标、封面、页面宽度。
- **数据库**：表格、看板、画廊、列表、日历、时间线和图表视图；筛选、排序、子项、双向关联、人员与 ID 属性、行模板（可定时重复）和公式。
- **部件**：用 JSON 数据绘制的图表、表格、热力图、徽章和流程图。
- **页面树**：嵌套页面、文件夹、拖放、收藏、模板、快速笔记。
- **分享**：发布页面或通过链接分享，对方看到简洁的只读页面。
- **Markdown 导入导出**：导入和导出 Markdown 以及 Notion 导出文件。
- **全文搜索**：搜索所有页面的正文。
- **智能体**：本地 MCP 端点和 REST API，让你的脚本和 AI 智能体读写页面。
- **备份**：一个 zip 包含所有表、所有文件和每个页面的 Markdown 副本；每天自动备份。
- **快速**：不依赖前端框架；编辑器或阅读器超出体积预算时构建会失败。
- **三种语言**：英文、韩文和简体中文界面。

## 快速开始

```sh
git clone https://github.com/Hakubisual/open-notion-acard.git
cd open-notion-acard
bun install
bun run build

# 仅本机使用
ACARD_DATA_DIR=./data ACARD_APP_DIR=./dist ACARD_LANG=zh bun local/main.ts
# 打开 http://127.0.0.1:47811/
```

要在局域网内共享，再加上 `ACARD_HOST=0.0.0.0`、`ACARD_PASSWORD=...` 和 `ACARD_ALLOWED_HOSTS=<服务器 IP>`。
[服务器安装指南](docs/install-server.md)（英文）逐步介绍 Windows 和 Linux 上的服务注册、防火墙、备份、更新和 HTTPS。
其他设备用浏览器或桌面应用连接（[客户端指南](docs/install-client.md)，英文）。

## 桌面应用：Acard Local

从[最新发布](https://github.com/Hakubisual/open-notion-acard/releases/latest)下载 `Acard-Local-Setup-<版本>.exe`。首次启动时它会询问服务器地址，确认该地址上有
Acard 服务器响应后，在独立窗口中打开。它与托管版 Acard 应用分开安装，互不影响。

> **Windows SmartScreen：** 安装程序暂未进行代码签名，Windows 可能提示 *"Windows 已保护你的电脑"*。
> 点击 **更多信息 → 仍要运行**，或者在 `desktop/` 中自行构建（见客户端指南）。

## 不包含的内容

本仓库是自托管核心。依赖托管服务的功能不在其中：AI 写作与润色、聊天智能体及其工作日志、邮箱与 Google 账号、
管理控制台和计费。这些位置由小型中性桩代码（`gate/hosted-*.ts`、`features/ai-service.js`、`local/edition.ts`）
代替，核心可以独立构建和运行。如果不想自己运行服务器，可以使用[托管版 Acard](https://acard.dev)。

## 参与贡献

欢迎提交问题、想法和拉取请求。请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)；安全问题请按 [SECURITY.md](SECURITY.md)
私下报告。各版本的变更见 [CHANGELOG.md](CHANGELOG.md)。

## 由 OpenNotion 更名而来

本项目在 v0.1.0 之前名为 OpenNotion。你的数据和设置会完整延续：服务器沿用相同的 `ACARD_*` 设置和数据文件夹，
`git pull` 会跟随 GitHub 的重定向到新地址，Acard Local 首次启动时会读取旧桌面应用中保存的服务器地址。

## 许可证

[MIT](LICENSE)。第三方声明：[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

Acard 是独立的开源项目，与 Notion Labs, Inc. 及 Obsidian 的开发者没有任何隶属、背书或赞助关系。
"Notion" 和 "Obsidian" 是其各自所有者的商标，此处仅用于说明和比较。
