# Memmy 工具能力：现状与桌面端工具页规划

- 日期：2026-10-14
- 状态：待评审
- 范围：memmy-agent 工具能力全景；桌面端「连接与工具」页改造；MCP preset 面向办公/普通用户的取舍

## 1. 现状：agent 的工具全景

| 能力 | 实现层 | 依赖 | 状态 |
|---|---|---|---|
| 内置工具集（exec/shell/spawn、文件系统、web_search/web_fetch、browser、cron、generate_image、goal、记忆检索、message） | memmy-agent runtime | 纯本地 | ✅ 默认开 |
| MCP（11 presets + 自定义；stdio / SSE / streamableHttp） | memmy-agent `tools/mcp.ts` + `/api/settings/mcp-presets` | 本地（server 可远程） | ✅ 已支持；桌面端无管理入口，仅会话轨迹里能看到调用 |
| 消息渠道 ×6（Telegram/Discord/iMessage/WeChat/Feishu/DingTalk）+ `message` 主动发送 | memmy-agent channels + 本地 admin API | 本地 | ✅ |
| Composio 118 集成 | 云 `/api/composio/*` ← 本地 `/mcp/composio` 桥 | memmy 云 + Composio | ✅ 但受身份限制：cuberouter 身份整页被 gate；按 tool calls 计费 |
| Skills（内置/工作区 `SKILL.md` + 记忆进化出的技能） | agent runtime + Memory 服务 | 本地 | ✅ 指导层（不是工具） |
| 扫描导入的技能（其他 agent 的 skill 文件） | `skill-distribution-service` | 本地 | ✅ |

要点：工具执行有两条腿——**本地**（内置工具集 + 用户自配 MCP）和**云代理**（Composio）；两条腿都汇入同一个 Tool registry，agent 侧不区分工具来自哪。

## 2. 规划：桌面端工具页三个分区

### 2.1 分区与可见性

| 分区 | cuberouter 身份 | 有 memmy 云 |
|---|---|---|
| 消息渠道 | ✅ 显示 | ✅ 显示（现状） |
| **MCP（新增）** | ✅ 显示 | ✅ 显示 |
| Composio 集成 | ✖ 隐藏（TODO） | ✅ 显示（现状） |

- 整页 gate 提示（「当前账号未连接 Memmy 云服务」）删除，改为分区级显隐；
- Composio 的自动加载与 5 秒轮询仅在云可用时启动；
- 导览（product tour）里 tools step 的显隐逻辑本轮不动（文案还是 Composio 口径，MCP 分区上线后一起改）；
- 其余 `canUseCloudFeatures` 入口（home 麦克风、赠送横幅等）确实依赖云，维持现状。

### 2.2 MCP 分区（新增）

- **Preset 安装器**：通用区展示 Brave Search、Exa 卡片，「开发者工具」折叠组（默认收起）收纳 Figma、Firecrawl；安装弹窗按字段声明动态渲染（如 Brave 的 API key、Exa 免 key 直接装）；
- **管理弹窗**（已安装）：连接测试（显示握手结果与工具数）、停用、卸载；
- **自定义 server 表单**：name / transport / command / args / env / cwd / url / headers / toolTimeout，字段与校验对齐 agent 端 `customServerFromQuery`；
- **数据通路**：桌面端直连 memmy-agent（沿用 `memmy-agent-client.ts` 的 bootstrap token 机制），调用现成的 `/api/settings/mcp-presets` 系列；enable/remove/custom 之后 agent 侧会附带回热重载结果。

本轮不做：Cursor/配置导入、`enabled_tools` 白名单编辑器（保持默认 `*`，改白名单走 yaml）。

### 2.3 Composio 集成（TODO）

本次不列出。未来若要让无 memmy 云的身份也能用，路径是「云侧提供类 memmy 云的一层」：

- 服务端按同一契约实现 5 个 `/api/composio/*` 端点（auth-configs / authorize / connections / delete / router execute）；
- 解决「谁能持有 connected accounts」——机器/账号到 Composio entity 的绑定；
- 本仓库侧几乎零代码（`MEMMY_CLOUD_SERVICE` 已是配置项，改地址即可）；
- 真正的成本在服务端与账单：Composio 按 tool calls 计费，额度与限流是产品决策。

## 3. MCP preset 的取舍（面向办公/普通用户）

判断依据：目标用户是办公与普通用户；通用能力已有内置兜底（web_search/web_fetch + 本地 browser）；自定义 server 表单是逃生舱——**删 preset ≠ 删能力**，想用的用户仍可手配。

| Preset | 是什么 | 受众 | 建议 |
|---|---|---|---|
| Brave Search | 网页/新闻/图片搜索 | 通用 | **保留** |
| Exa | 网页搜索 + 正文抓取（免 key） | 通用 | **保留** |
| Figma | 读设计稿（官方 Dev Mode） | 设计/开发 | 折叠（「开发者工具」组） |
| Firecrawl | 抓取/爬取/抽取 | 数据/开发 | 折叠（「开发者工具」组） |
| Browserbase | 云浏览器自动化 | 开发 | 建议去掉（内置 browser 已覆盖） |
| GitHub | 仓库 / issue / PR | 开发 | 建议去掉 |
| Supabase | 数据库管理 | 开发 | 建议去掉 |
| Postman | API 管理 | 开发 | 建议去掉 |
| Context7 | 库文档检索 | 开发 | 建议去掉 |
| Microsoft Learn | 微软官方文档 | 开发/IT | 建议去掉 |
| AWS Documentation | AWS 文档 | 开发 | 建议去掉 |

推荐（已定）：preset 列表保留 **Brave Search、Exa** 两个通用类；**7 个直接删除**（表中「建议去掉」）；**Figma、Firecrawl 折叠进默认收起的「开发者工具」分组**。删除的能力损失由自定义 server 表单兜底。

- 折叠分组的归属用 preset 元数据上的显式标记（agent 侧加字段），不复用现有 `category`——Exa/Brave/Firecrawl 同属 "web" 类，无法靠它区分；
- 删除的代价：开发者用户少一条开箱路径（自定义表单兜底）；
- 删除的收益：面向普通用户的列表更干净，符合产品定位；
- 实现影响：改 agent 侧 `MCP_PRESETS` 数组（删 7 个、给 2 个加折叠标记）及少量 i18n/文档引用；已安装过的用户不受影响（配置里已有 `mcpServers` 条目，卡片消失而已）。

## 附录 A：Composio 118 个集成（按工具页现有分类）

**Chat（8）**：Dialpad、Discord、Discord Bot、Microsoft Teams、Slack、Slackbot、Webex、WhatsApp Business

**Social（7）**：Facebook、Instagram、LinkedIn、Reddit、Reddit Ads、Stack Exchange、YouTube

**Productivity（39）**：Asana、Basecamp、Box、Cal、Calendly、ClickUp、Confluence、Dropbox、Excel、Figma、Gmail、Google Ads、Google Analytics、Google BigQuery、Google Calendar、Google Classroom、Google Docs、Google Drive、Google Maps、Google Meet、Google Photos、Google Search Console、Google Sheets、Google Slides、Google Super、Google Tasks、Jira、Linear、Miro、Monday、Mural、Notion、OneDrive、Outlook、SharePoint、Todoist、Trello、Typeform、Wrike

**Platform（21）**：Bitbucket、Contentful、Convex、DigitalOcean、GitHub、GitLab、HubSpot、Prisma、QuickBooks、Salesforce、Sentry、Stripe、Supabase、Zendesk、Zoho、Zoho Bigin、Zoho Books、Zoho Desk、Zoho Inventory、Zoho Invoice、Zoho Mail

**Tools & Automation（43）**：Airtable、Apaleo、Attio、Blackbaud、Boldsign、Canva、Capsule CRM、Crowdin、Dart、Dub、Dynamics 365、Eventbrite、Exist、Fathom、Freeagent、FreshBooks、Gorgias、Gumroad、Harvest、Hugging Face、Intercom、Kit、Linkhut、Mailchimp、Moneybird、Omnisend、PagerDuty、Productboard、Pushbullet、Roam、Servicem8、Shippo、Splitwise、Square、Strava、Ticketmaster、Ticktick、Timely、Toneden、WakaTime、Yandex、YNAB、Zoom

（分类来自前端 `guessIntegrationCategory` 的关键词匹配，Google 系被 "google" 一键吞进 Productivity，Zoom 落在 Tools & Automation——已知粗糙，仅作参考。）

## 附录 B：MCP 精选 preset（11 个）

| Preset | 做什么 | 传输 | 凭据要求 |
|---|---|---|---|
| GitHub | 仓库 / issue / PR（官方 MCP server） | stdio（docker） | GitHub PAT + 需要 Docker |
| Figma | 读设计稿（官方 Dev Mode MCP） | streamableHttp（本机 3845） | 无；需 Figma 桌面版开着 Dev Mode |
| Supabase | 查看 / 管理 Supabase 项目 | stdio（npx，默认 --read-only） | Supabase access token |
| Postman | 管理 Postman API / 集合 / 工作区 | stdio（npx） | Postman API key |
| Brave Search | 网页 / 新闻 / 图片 / 视频 / 本地搜索 | stdio（npx） | Brave Search API key |
| Firecrawl | 网页抓取 / 爬取 / 搜索 / 抽取 | stdio（npx） | Firecrawl API key |
| Exa | 网页搜索 + 干净正文抓取 | streamableHttp（托管） | 无 |
| Context7 | 库的最新文档 / 代码示例 | stdio（npx） | 可选 |
| Browserbase | 云端浏览器自动化 | streamableHttp（托管） | Browserbase API key |
| Microsoft Learn | 搜 / 取微软官方文档 | streamableHttp（托管） | 无 |
| AWS Documentation | 搜 AWS 文档 | stdio（uvx） | 无（需要 uvx） |

来源：`App/memmy-agent/src/entrypoints/frontend-bridge/mcp-presets-api.ts:67`
