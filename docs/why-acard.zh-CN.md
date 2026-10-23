<p align="center"><a href="why-acard.md">English</a> · <a href="why-acard.ko.md">한국어</a> · <b>简体中文</b></p>

# 为什么选 Acard

Acard 是一个可以在本地运行的开源 Notion。本文把它与常被拿来比较的 Notion 和 Obsidian 放在一起，说明这句话的含义。
这两款工具都很出色，适合很多人。Acard 是另一种取舍，下表列出了区别所在。

关于 Acard 的每一项说法都指向本仓库中实现它的文件。关于 Notion 和 Obsidian 的内容来自它们的官方帮助页面
（链接见文末），截至 2026 年 10 月，之后可能会变化。

## 一览

| | Acard | Notion | Obsidian |
| --- | --- | --- | --- |
| 数据存放位置 | 你选定文件夹里的 SQLite 文件 | Notion 云端；应用内可保存离线副本 | 本地仓库里的 Markdown 文件 |
| 为团队自托管 | 可以：在局域网或 VPN 上运行一个 Bun 进程 | 不可以 | 没有内置；共享仓库需使用 Obsidian Sync |
| 编辑方式 | 块、分栏、数据库 | 块、分栏、数据库 | Markdown 文本、插件 |
| 数据库 | 7 种视图、关联、汇总、子项、公式、行模板 | 多种视图、关联、汇总、公式 | Bases：基于笔记属性的数据库视图 |
| 离线使用 | 始终可用：服务器就在你的设备上 | 桌面和移动应用中已下载的页面 | 始终可用 |
| 智能体与脚本 | 你自己服务器上的 MCP 端点和 REST API | Notion 云端的 API 与托管 MCP | 社区插件，或直接编辑文件 |
| 备份格式 | 一个 zip：所有表、所有文件、每个页面的 Markdown | 导出为 Markdown/CSV、HTML 或 PDF | 仓库文件夹本身 |
| 源代码 | AGPL-3.0 许可 | 闭源 | 应用闭源，插件 API 开放 |

## 与 Notion 相比

**文档留在你自己的硬件上。** Acard 服务器把所有内容写入 `ACARD_DATA_DIR` 指定文件夹中的 `acard.sqlite` 和
`media.sqlite`（`local/server.ts`）。无需注册账号，中间也没有任何外部服务。Notion 把工作区放在自己的云端，
只在应用中下载选定的页面供离线使用。

**可以为团队自建服务器。** 加上 `ACARD_HOST=0.0.0.0` 和 `ACARD_PASSWORD`，同一个进程就成为带密码登录、
并用主机白名单防御 DNS 重绑定的局域网服务器（`local/main.ts`、`local/server.ts`）。[服务器安装指南](install-server.md)
介绍了如何注册为 Windows 或 Linux 服务。Notion 没有自托管版本。

**熟悉的编辑方式，开放的代码。** 页面由块组成，支持 `/` 命令、分栏、折叠块、标注，以及带表格、看板、画廊、列表、
日历、时间线和图表视图的数据库（`db-model.js`、`editor-next/`）。所有代码都可以在 AGPL-3.0 许可下阅读和修改。

**Notion 页面可以直接迁移。** `notion-import.ts` 读取 Notion 的 "Markdown & CSV" 导出 zip，包括页面和数据库。
`notion-export.ts` 可以再导出为 Markdown、独立 HTML 和工作区 zip。

**智能体在你自己的服务器上工作。** 本地服务器在 `/mcp` 提供 MCP，并提供 REST API（`agents/mcp-tools.ts`、
`agent-api.js`）。你电脑上的智能体无需经过云端，就能以 Markdown 读写页面。

Notion 更强的地方：多人实时协作（显示光标）、庞大的模板与集成生态、成熟的移动应用，以及多得多的数据库功能。
如果你想要托管服务，Notion（或[托管版 Acard](https://acard.dev)）会更省事。

## 与 Obsidian 相比

**数据库和块是一等公民。** Acard 把页面存为有序的块，把数据库存为真正的表，带有类型化属性、视图、关联、子项和公式
（`gate/_worker.js` 中的表结构、`db-formula.js`）。Obsidian 以 Markdown 文本为中心，其 Bases 插件在笔记属性之上
提供数据库式视图。

**一台服务器，多台设备，无需同步服务。** 所有浏览器、手机和桌面应用都连接同一台服务器，内容变化时实时推送
（`/api/live`、`gate/live.ts`）会刷新已打开的页面。团队共享一个地址，就能共用一个工作区。Obsidian 在每台设备上
各有一个仓库，多人共享仓库需使用 Obsidian Sync。

**为人和智能体协同而设计。** 智能体通过 MCP 或 REST 写入 Markdown，人则把同样的内容当作整洁的页面阅读、按块编辑
（`markdown-blocks.ts` 是把 Markdown 转为块的唯一规则）。页面可以发布，或通过链接只读分享（`features/share.js`）。

**可读的备份。** 备份 zip（`gate/archive.ts`）以 JSON 保存所有表，并包含所有文件和每个页面的 Markdown 副本，
即使没有 Acard 也能读你的笔记。`local/auto-backup.ts` 每天生成一份并保留最新的几份。
`packages/acard-cli` 还可以把页面同步到一个 `.md` 文件夹。

Obsidian 更强的地方：笔记本身就是普通文件，任何编辑器、Git 或文件同步工具都能直接使用。它拥有庞大的插件和主题生态、
关系图谱、成熟的移动应用，以及端到端加密的 Sync。如果你想要一个个人 Markdown 仓库，Obsidian 非常合适。

## 什么时候适合选 Acard

- 你想要 Notion 式的页面和数据库，但文档必须留在自己的设备或内网里。
- 小团队希望在办公室服务器上共用一个工作区，而不必为每个人开通云端账号。
- 你使用 AI 智能体，希望它们通过 MCP 在本地读写你的笔记。
- 你希望能阅读、审计或修改代码。

## 资料来源

- Notion 离线使用：https://www.notion.com/help/use-pages-offline
- Notion 导出：https://www.notion.com/help/export-your-content
- Obsidian Bases：https://obsidian.md/help/bases
- Obsidian 共享仓库：https://obsidian.md/help/sync/collaborate
- Obsidian 许可：https://obsidian.md/license
