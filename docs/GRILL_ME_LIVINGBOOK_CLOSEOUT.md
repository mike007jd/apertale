# Apertale / LivingBook — GRILL ME 收官产品基线

> 状态：历史决策记录；当前实现与交付状态以 [`PRODUCT_ARCHITECTURE.md`](PRODUCT_ARCHITECTURE.md) 和 [`CHALLENGE_READINESS.md`](CHALLENGE_READINESS.md) 为准
>
> 核对日期：2026-08-28 NZST
>
> 保留范围：创作入口、照片 handoff、D1/R2 capability、撤销/删除顺序、隐私边界和首屏性能的决策来源。

## 1. 一句话结论

Apertale 让用户在自己的 ChatGPT/Codex 对话中完成理解、故事设计和生成，并在 Site 的可视画布中查看、编辑和发布互动绘本；Site 不嵌入由站点方付费的 ChatKit/AI 对话，也不假装 Safari 中存在 ChatGPT composer。

## 2. GRILL ME 设计树结论

### A. 谁承担 AI 推理与生成

- **已定**：访问者自己的 ChatGPT/Codex 套餐与用量承担 AI 理解、故事设计、文案和图像生成。
- **已定**：Site 不保存站点作者的 OpenAI API key，不通过页面反向调用当前 Codex 会话。
- **已定**：不接 ChatKit。ChatKit 是可嵌入聊天 UI，但按当前官方文档，新项目要连接自己的 server-side agent；现有 hosted workflow 只是 Agent Builder 退场期兼容路径。官方示例也要求服务端 `OPENAI_API_KEY` 创建 ChatKit session。它会把推理责任和计费切到站点方 API 项目，与本产品硬约束冲突。

### B. Agent 与 Site 如何分工

- **ChatGPT/Codex 对话**：自然语言意图、照片理解、故事规划、生成决策、图片生成或编辑。
- **Apertale Site**：样书书架、一次最小 Image handoff、结构化 manifest、BookEngine 编辑状态、书籍渲染、发布与只读分享。
- **WebMCP**：在 ChatGPT desktop 内置浏览器中把当前开放页面作为共享画布；七个语义工具是唯一 Agent 操作面。
- **独立浏览器**：Safari/Chrome 可以浏览书架和公开分享成品，但没有 ChatGPT composer。创作引导必须说明在 ChatGPT desktop 内置浏览器打开本 Site，并在旁边的真实对话中继续。
- **深链边界**：截至核对日，官方 Sites / Site Tools 文档没有给出可验证的“从任意 Safari 页面直接在 ChatGPT desktop 打开当前 Site”的通用深链协议。因此当前只提供诚实说明和站内 handoff，不发明 URL scheme；正式深链标记为待验证。

### C. 两条现场创建路径

1. **文字创建**
   1. 先展示现有 5 本 sample。
   2. 用户在 ChatGPT/Codex 中给出主题、页数、风格和受众。
   3. Agent 读取当前项目，创建独立新书，动态规划并生成内容，不套用写死模板。
   4. Site 按 revision/manifest 渲染，用户可继续人工或 Agent 编辑。
   5. 创作者发布后取得专属分享 URL 与创作者管理能力。
2. **照片创建**
   1. 用户在 Site 的 workshop 做一次明确的 Image handoff；页面只返回稳定 `assetId`，不要求重复故事 brief。
   2. 用户在旁边的 ChatGPT/Codex 对话中要求把个人照片做成温馨绘本或相册叙事。
   3. Agent 重新读取资产上下文并动态创作书籍。
   4. 发布流程将 manifest 元数据写入 D1、引用的图片字节写入 R2。

若将来主机提供经过验证的附件二进制桥，只替换 `AssetAdapter`；不改变书籍 manifest、BookEngine 或发布语义。

### D. 持久化与发布

- **D1**：书籍状态、revision、manifest JSON、发布时间、撤销状态、R2 对象索引，以及哈希后的管理/分享 capability。
- **R2**：用户 handoff 或生成的图片文件。D1 不保存大二进制。
- **本地存储**：`localStorage` / IndexedDB 保留编辑草稿、设备偏好、本地 handoff 和本机 creator capability；服务端 D1/R2 是已发布成品的权威来源。Web Locks 按 document 串行化同源标签页里的发布、撤销和删除，避免生成两个无法同时管理的服务端身份。
- **发布状态机**：`draft/revoked -> publishing claim -> published`。同一 claim 可恢复；不同 share token 不能覆盖它。任意可管理状态也可进入 `deleting` 后完成永久删除。
- **当前服务端契约**：
  - `POST /api/books`：幂等登记客户端预先生成并本地持久化的 `bookId` 与 256-bit 创作者 capability；服务端不返回 capability。
  - `PUT /api/books/:bookId/assets/:assetId`：上传已验证 PNG/JPEG/WebP；单文件最多 1.5 MB，每书最多 50 个文件。
  - `POST /api/books/:bookId/publish`：校验 manifest 和所有本地资产引用后发布，返回专属 `/share/:token`。
  - `POST /api/books/:bookId/publish/reconcile`：恢复已提交的分享 URL 和准确 revision；未提交时以同一 share token 原子认领可恢复的发布尝试，或确认该 token 已撤销。
  - `GET /api/shared/:token` 与 `GET /api/shared/:token/assets/:assetId`：匿名只读读取。
  - `POST /api/books/:bookId/revoke`：立刻使旧分享 URL 失效，文件保留以便重新发布。
  - `DELETE /api/books/:bookId`：先切断公开访问并进入 `deleting`，再删 R2，最后删 D1；中途失败可安全重试。

### E. 分享与隐私语义

- 分享 token 与管理 token 都是不可枚举的 256-bit capability；D1 只保存 SHA-256，公开目录不列出成品。
- `/share/:token` 无需登录，但“拿到链接的人可查看”就是权限模型；它不是端到端加密或私密相册。
- 只读分享可以翻页、切换 Day/Night、触发声明式 hover/click/reveal；不能修改 manifest 或上传文件。
- 撤销让旧分享 capability 立即失效，并在 D1 的 retired-token 账本永久保留其哈希；删除也退休当时的公开 token。任何书或后续发布代次都不能复用旧 URL。旧 URL 和资产 URL 都返回 404，并使用 `private, no-store` 避免撤销后继续被共享缓存读取。
- 删除是永久动作；先进入不可公开的 `deleting` 状态，R2/D1 跨资源删除采用可重试顺序，不宣称分布式原子事务。
- 个人照片、标题、正文和互动说明都可能构成个人数据。公开发布前必须复核授权、人物隐私和分享范围。Sites 当前不支持 data/inference residency；不得收集 PHI、支付卡数据，也不得面向 13 岁以下或当地数字同意年龄以下儿童。
- 创作者 capability 必须由客户端安全持久化且不出现在 URL、日志或 D1 明文中。当前默认分支尚无账号恢复机制，丢失 capability 即无法管理该成品；这是发布 UI 接入前必须显式告知的产品限制。

### F. 首屏和按需加载

- 根路由必须先显示轻量书架；不得在书架背后挂载 reader。
- 首屏只加载 shell、当前主题背景和可见封面；不加载 Three.js、全尺寸 spread、cutout、帧动画或整本交互素材。
- 用户打开一本书后，先加载当前 spread 和当前交互元素；当前 spread ready 后再预取前后相邻 spread 的背景。进入相邻 spread 后再加载它的交互元素。
- 分享 URL 同样先读取一份 manifest，再按当前/相邻 spread 加载媒体。
- Day 首屏不预加载 Night 背景；切换 Night 时再请求。

2026-08-28 本地 production build + Playwright 实测：

| 场景 | 修改前 | 当前实现 |
|---|---|---|
| 根路由可访问面 | 书架可见，但底下仍存在单本 reader、Story 和交互控件 | 可访问树只保留书架；reader 未挂载 |
| 首屏 3D | 约 91 ms 即请求 `ThreeBook` 与 `three` | 首屏无 `ThreeBook` / `three` 请求 |
| 首屏书页 | 未点击即请求当前 Colosseum 全图；约 1 s 后请求 Atlas 其余 7 个 clean plate 和全书 cutout | 首屏无 spread/cutout 请求 |
| 主题背景 | Day 与不可见 Night 都请求 | 只请求 Day；Night 按切换加载 |
| Atlas 打开后 | 全书媒体约 9.33 MB 被主动请求 | 当前 clean plate + 当前两个 cutout；当前 ready 后只预取下一 spread clean plate |

本次改动的停止点是消除已测得的无用户意图请求。封面本身仍约 1.9 MB，并且是书架首屏的必要内容；继续压缩/换格式属于正在并行进行的素材优化范围，不在本任务改写。

## 3. 事实、决策与待验证边界

### 已由官方资料确认

- Sites 用 `.openai/hosting.json` 记录 D1/R2 逻辑 binding；结构化持久数据用 D1，上传文件用 R2。
- 公开 Site 可以无需 ChatGPT workspace 登录访问；Site audience 与应用内身份是两套独立控制。
- Sites 当前每 Site 的 D1 上限为 10 GB，R2 无固定容量上限，但 beta 仍有账号/工作区总体用量限制。
- WebMCP Site Tools 的正确入口是 ChatGPT desktop 内置浏览器里的当前开放页面；Safari 不会自动附带 ChatGPT 对话。
- ChatKit 新项目需要自己的 server-side agent；官方 session 流程要求服务端密钥/客户端 secret 交换。

官方来源：

- [ChatGPT Sites developer guide](https://learn.chatgpt.com/docs/sites)
- [Creating and managing ChatGPT Sites](https://help.openai.com/en/articles/20001339-creating-and-managing-chatgpt-sites)
- [Using site tools in the ChatGPT desktop app](https://help.openai.com/en/articles/20001423-using-site-tools-in-the-chatgpt-desktop-app)
- [ChatKit](https://developers.openai.com/api/docs/guides/chatkit)

### 当前仓库已实现

- 既有 `BookEngine` / `DocumentState` manifest、七个 WebMCP 工具和浏览器本地 Image handoff。
- `.openai/hosting.json` 的逻辑 bindings：D1=`DB`、R2=`FILES`。
- 独立 D1 repository、R2 对象访问、发布/读取/撤销/删除 API、哈希 capability、只读分享路由和分享 reader。
- 分享 manifest 复用现有 `DocumentState`；读取时只把 `asset:` 引用水合为当前 share token 下的只读资产 URL。
- 核心成功路径测试覆盖草稿、上传、发布、匿名读取和图片读取；关键失败路径证明撤销后 manifest、资产和 HTML shell 都 fail closed。
- 首屏 reader 卸载、Three.js 延迟加载、当前 spread 优先、相邻 spread 预取和独立浏览器创作说明。

### 该检查点之后的结果与剩余边界

- React 编辑器已经接入发布、撤销、复制分享链接和永久删除；发布只上传当前 manifest 引用的 IndexedDB Blob。
- D1/R2 的真实 Sites CRUD、匿名 reader、撤销和删除生命周期已经通过生产验证；证据见 [`qa/livingbook-final-closeout-2026-08-28/REPORT.md`](qa/livingbook-final-closeout-2026-08-28/REPORT.md)。
- 当前 capability-only 匿名创建没有账号恢复或身份级滥用策略；已有站点总量、时间窗和每书资产上限，进一步公开运营仍需可验证身份或更强的滥用控制。
- “Open in ChatGPT”通用深链待官方契约确认；当前 UI 只说明正确操作，不生成未验证协议。
- 两条 Site Tools E2E 和公开 live URL 已通过；公开 repo、带音频且少于 3 分钟的 YouTube 视频与 Devpost 仍是外部门槛。

## 4. 比赛硬门槛

提交前全部必须为真：

1. 公开 live URL 匿名可访问，根路由落在书架，分享 URL 匿名只读可访问。
2. 公开源码仓库包含源代码、运行说明、资产来源和显眼的开源许可证。
3. 文字创建和一次 Site Image handoff 的照片创建都在真实 ChatGPT desktop Site Tools 环境完成。
4. 发布、匿名读取、撤销和删除在真实 D1/R2 上完成；旧 token 失效得到外部验证。
5. 公开 YouTube 演示少于 3 分钟且带音频，先展示 5 本 sample，再分别跑两条创建路径，并展示分享 URL。
6. 产品说明明确：AI 使用访问者自己的 ChatGPT/Codex 能力；Site 不包含站点作者付费的 ChatKit/API 推理。
7. 所有 Devpost 必填字段在截止前完成，且 URL、repo、视频都由匿名或评委视角复核。

## 5. 验收标准

### 本地代码门禁

- `npm run typecheck`
- `npm test`
- `npm run test:sites`
- production build 图确认根路由不把 `ThreeBook` / `three` 放进首屏执行路径。
- 浏览器网络记录确认根路由没有 spread/cutout 请求；打开一本书只出现当前素材，当前 ready 后只预取相邻背景。

### 持久化与隐私门禁

- 未上传的 `asset:` 引用阻止发布；任意远程 URL、`data:`、`blob:` 或可执行内容阻止发布。
- 没有正确管理 capability 时，发布、上传、撤销和删除均不可用。
- 分享 token 不存在、已撤销或删除时，manifest、资产和 HTML shell 都是 404。
- 删除中断时保持不可公开并可重试，不留下“数据库已删但公开文件仍可读”的顺序。

### 产品门禁

- Safari 首屏是书架，不是单本书；Safari 文案不暗示存在 ChatGPT composer。
- ChatGPT desktop 中，Site 与真实对话并排，七工具可发现且创建、发布和分享路径可完成。
- 分享 reader 没有编辑、上传、Agent 工具或管理 token 泄漏。
- 不把 starter copy、Image handoff 或任何局部输入样式成完整 AI 对话框。

## 6. 停止条件

本收官基线只有在以下状态才可称为完成：代码门禁通过；真实 Sites D1/R2 与匿名分享 E2E 通过；Safari/ChatGPT desktop 两类访问语义真实；两条创建路径完成；公开 live URL、公开 repo、许可证、公开 YouTube 视频和提交文本全部存在并经过匿名复核。

若真实 Sites binding、ChatGPT deep link、附件桥或账号权限缺少官方契约，停止在“独立模块 + 明确整合点 + 未验证标记”，不猜 API、不部署 workaround、不把局部 UI 描述成已完成平台能力。
