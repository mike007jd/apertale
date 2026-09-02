# Apertale 59 秒中文产品宣传视频拍摄脚本

> 状态：可执行拍摄稿；不是已发布成片
>
> 核实时间：2026-09-02（Pacific/Auckland）
>
> 核实基线：以录制前最后一次生产部署、HTTP 门禁和 Codex 内置 Browser 端到端结果为准
>
> 用途：OpenAI The WebMCP Challenge 的公开演示视频；官方要求是带音频、公开、少于 3 分钟，本稿目标 59 秒

## 一句话定位

**Apertale 是一个 WebMCP 原生的互动书籍创作画布：用户在 Codex 中用一句描述、参考图片或个人照片提出创作意图，Codex 通过同一页面的 Site tools（WebMCP）创建和修改互动书；成品可发布为只读分享链接。**

推荐中文总称：**互动书籍创作画布**。它比“绘本生成器”准确，因为产品还覆盖插画知识书、照片驱动的纪念书，以及用户明确要求的字面 photo album。

推荐英文术语：

- 产品总称：`interactive book canvas`
- 插画故事书：`illustrated storybook`
- 插画知识书：`illustrated knowledge book`
- 照片驱动的纪念书：`photo-led keepsake` 或 `illustrated memory book`
- 直接保留照片版式的相册：`photo book` 或 `keepsake album`

只有画面确实采用原始照片作为成品页时才说 `photo book` / “照片相册”。默认照片流程会把照片当作故事事实和视觉参考，再生成完整跨页画面，应该说 `photo-led keepsake`，不要误称为普通照片排版工具。

## 拍摄前准备

1. Screen Studio 设为 16:9、1920×1080、30 fps；隐藏通知、个人账号信息、其他任务和无关标签页。
2. 画面采用左右分栏：Codex 对话约 42%，内置 Browser 约 58%。保持浏览器地址栏可在技术镜头中短暂出现。
3. 在当前任务中选择 **GPT-5.6 Sol**；叶子型号是 **`gpt-5.6-sol`**。片中不要只写模糊的“GPT-5.6”。
4. 打开当前 ChatGPT Sites 部署：`https://livingbook-studio-challenge-11.mike007jd2.chatgpt.site/`。录制前再运行一次项目自带的 `verify:deployment`，并确认地址栏里能展开 **Site tools**。
5. 准备三张已获授权、无敏感信息的旅行或家庭照片。为了最终公开分享，优先用无真实隐私风险的演示照片。
6. 准备三个可快速打开的成品：
   - 插画知识书：`Atlas of Living Wonders`
   - 插画故事书：`Your Story, Made Alive` 或 `The Lantern Garden`
   - 照片驱动的纪念书：优先使用录制账号里的 `[个人照片纪念册标题]`；没有时使用已验证的 `The Starlight Stitch`，并在口播中称“根据照片制作的纪念书”，不要称“家庭照片相册”。
7. 保底分享结果可使用当前已验证的只读成品：`https://livingbook-studio-challenge-11.mike007jd2.chatgpt.site/share/EuyDfVjurmjTsnZxAHNmmZJ-8eYCaB-Ofn4Eb84wK_U`。正式实操优先展示本次新生成、确认可公开的书。
8. 先完整录下真实生成和发布过程，再剪等待。不要为了节奏中断真实 Site tools 调用。

## 59 秒主脚本

| 时间 | 画面与构图 | 鼠标操作 | 中文口播 | 剪辑与录制备注 |
|---|---|---|---|---|
| 00:00–00:04 | 极短成品蒙太奇：Atlas 跨页翻动 → 照片驱动纪念书 → 匿名只读分享页。每个画面约 1 秒。 | 无需保留鼠标；用后段素材倒叙剪入。 | **“一句话，或者一组照片，都能变成一本会互动的书。”** | 硬切，开场即见结果；不放长 Logo 动画。最后 0.5 秒叠字：`Apertale — Open a page. Enter a world.` |
| 00:04–00:11 | Codex 与 Apertale 并排。右侧停在漂亮的完整跨页，左侧露出当前任务标题和已选择模型，但遮住个人信息。叠字：`Codex · GPT-5.6 Sol · ChatGPT Sites`。 | 鼠标从 Codex 模型位置平滑移到右侧书页，不点击。 | **“这是 Apertale，一个在 Codex 里完成的 WebMCP 项目。这次演示用 GPT-5.6 Sol，部署在 ChatGPT Sites。”** | 这是事实安全版。只有确认完整开发历史都使用该模型时，才改成“我用 Codex 和 GPT-5.6 Sol 构建了 Apertale”。 |
| 00:11–00:16 | 右侧地址栏展开 Site tools，短暂看到八个工具；随即收起，恢复完整书页。叠字：`Site tools (WebMCP)`。 | 点击地址栏的 **Site tools**，停 1.5 秒，再点空白处收起。 | **“Site tools，也就是 WebMCP，让 Codex 直接操作我正在看的同一页。”** | 列表只需证明页面提供八个工具，不逐个念名字。画面必须来自真实内置 Browser，不用静态假图代替。 |
| 00:16–00:24 | 快速浏览三本成品：Atlas → 故事书 → `[个人照片纪念册标题]`。每本保留一个封面或跨页特征。 | 点 **Books**；依次点书封。每次打开后翻一页或触发一次 hover/click reveal。 | **“这里有插画知识书、故事书，也能把个人照片做成纪念书或相册。”** | 用 3 个跳剪压缩打开动画。若第三本是 `The Starlight Stitch`，画面标签写 `Photo-led keepsake`，不写 `Photo album`。 |
| 00:24–00:30 | 进入 **Create your own** 工作台：空白 3D 书打开，依次出现 `Idea + photos`、`Illustrated keepsake`、`4` spreads、`Watercolor` 与三张照片缩略图。 | 点击 **Create your own** → **Idea + photos** → **Illustrated keepsake** → **4** → **Watercolor** → **Add**，选择三张照片。 | **“现在，我用几张旅行照片，做一本四跨页的水彩纪念册。”** | `Photo use` 是 readiness 的必选项，不能跳过。原始动作可录 15–20 秒，后期压到 6 秒。 |
| 00:30–00:36 | 点击复制 brief，焦点回到左侧 Codex，粘贴并提交。右侧工作台状态变为 “Codex found this page”，随后铅笔在空白书页上逐笔画出方框、椭圆、箭头和标签，四个跨页依次出现；页面回执 “Codex sketched 4 spreads”。 | 点 **Copy starter prompt**；在 Codex 输入框补一句实操输入文本，粘贴 brief，发送；铅笔揭示时鼠标不动。 | **“提交后，Codex 先在我看的这张纸上画出整本书的草图。”** | 这是全片的 WebMCP 主证据：铅笔逐笔揭示必须来自真实 `sketch_storyboard` 调用，不用后期动画代替。保留活动条 `Sketch storyboards` 和回执入镜。若 brief 带了读者照片，让 Codex 给对应方框写 `assetId`，铅笔框里会出现灰色照片幽灵，这一帧值得停半秒。 |
| 00:36–00:42 | 我拿起红笔：在跨页 2 圈住 `boat`，划掉 `lighthouse`。Codex 读取后只重画跨页 2，红笔消失，回执 “Codex applied your marks on spread 2”。 | 点 **Mark changes**，画一个圈、一条划线，再点停止；在 Codex 输入 “读我的标记并修改草图”。 | **“我不打字，我画。Codex 读到的是‘右页圈了船’，只改这一页。”** | Codex 回复里那句 “右页圈住了 boat” 要短暂入镜。等待超过 2 秒即跳剪，但红笔消失与回执必须是连续画面。 |
| 00:42–00:47 | Codex 请求图片 handoff，用户在右侧抽屉真实点击 **Add** 选择成品图；随后 `manage_book` 创建，铅笔稿让位给成品书。 | 在 handoff 抽屉点 **Add**，选择已生成的封面、跨页、clean plate 和 cutout。 | **“然后它生成画面，把书一页页做出来。”** | 提前把生成后的文件保存为可选文件；WebMCP 不会自动搬运图片字节。成片用 6–12 倍加速，但至少保留一次真实 handoff 和新书出现。 |
| 00:47–00:52 | 成品全屏。翻两页，悬停一个前景元素，再点击打开事实卡。 | 收起面板；点向右翻页两次；悬停约 0.7 秒，再点击。 | **“等待我加速了。现在，直接翻一遍成品。”** | 这一段不要切回设置界面；让观众看到完整书、真实翻页与互动结果。 |
| 00:52–00:57 | 打开发布面板，`Public link` 显示完整只读 URL。 | 点 **Publish** → **Publish and share**；成功后停在完整链接上。 | **“最后点 Publish and share，把链接发给别人就能读。”** | 发布等待超过 1 秒时跳剪。画面同时保留完整 URL 和 `Anyone with it can view` 提示。 |
| 00:57–00:59 | 分享链接仍清晰可见，淡出到 Apertale 字标和 tagline。 | 鼠标移出主体。 | **“Apertale。打开一页，进入一个世界。”** | 幕后端到端必须已用匿名请求验证该链接。 |

## 实操输入文本

在工作台选择 `Idea + photos / Illustrated keepsake / 4 spreads / Watercolor` 并复制 brief 后，在 Codex 输入框最前面补这一句：

> 请把这些照片做成一本给家人共同回忆的、温暖的南岛旅行纪念书。保留真实地点和人物关系，故事从出发、相遇、意外天气写到回家后的回味。完成后逐页检查互动和照片来源，不要编造照片里没有的内容。

然后粘贴工作台生成的 creation brief 并发送。工作台 brief 已包含照片用途、稳定照片 ID、页数、风格、先规划/生成再布局的顺序，以及 Site tools 验收条件；前句补齐了 audience，所以不会停下来追问读者是谁。生成图片后仍需由用户真实点击 `book-art` handoff 的 **Add**，粘贴或选择成品文件；提前把这些文件准备在易找的位置。

如果要演示真正的直接照片相册，而不是照片驱动的插画纪念书，把第一句改为：

> 请把这些照片做成一本四跨页的直接照片相册，保留原始照片作为主要成品画面；只做克制的裁切、标题、日期和版式整理，不把照片改画成插画。

这个明确请求符合产品的 literal photo-album 例外。没有发出这句请求时，不把原始照片直接铺在右页当作完成品。

## 录制和剪辑停止条件

可以结束拍摄的最低证据：

- 片头出现至少两个不同类型的完整成品；
- 技术镜头准确出现 `GPT-5.6 Sol`、`ChatGPT Sites`、`Site tools (WebMCP)`；
- 真实 Site tools 列表或调用至少出现一次；
- 实操完整覆盖照片导入、Codex 提交、铅笔草图逐笔揭示、红笔标注、Codex 只重画标记跨页并清除标注、成品翻阅；
- 新生成书的 **Publish and share** 成功，完整链接在画面中可读；同一链接已在拍摄前通过匿名只读验证；
- 全片 40–60 秒、中文人声清楚、没有账号隐私或未授权照片；
- 静音回看时，仅凭画面和少量叠字也能理解“输入 → 草图 → 红笔 → 修改 → 成品 → 分享”。

## 后续英文自动产出约束

英文版是按镜头重写，不是逐字翻译：

1. 保持同一时间轴，总时长控制在 59 秒内；每个镜头只保留一个口语化信息点。
2. 按实际口播速度写 125–145 wpm；优先删解释，不压缩发音或强行塞满句子。
3. 专有名词固定为：`Apertale`、`Codex`、`GPT-5.6 Sol`、`ChatGPT Sites`、`Site tools`、`WebMCP`、`ImageGen`、`Publish and share`。
4. 给 IndexTTS 的朗读文本把模型写成 `GPT five point six Sol`；画面叠字仍写 `GPT-5.6 Sol` / `gpt-5.6-sol`。
5. 英文旁白使用短句和自然停顿；避免括号、斜杠、长串工具名和中式被动语态。
6. `photo-led keepsake` 用于照片作为参考并生成跨页插画的成品；只有原始照片保留为主要页画面时才用 `photo book` 或 `keepsake album`。
7. 每条英文旁白附对应时间码，并在交给 IndexTTS 前单独输出纯朗读版，去掉 Markdown、镜头说明和 URL。
8. 只保留两个可变项：`[个人照片纪念册标题]` 与 `[公开项目链接]`。分享链接若未最终确认，英文音轨不念 URL，只说 `a read-only link`。

## 产品事实与术语证据

| 结论 | 当前证据 |
|---|---|
| 正式品牌为 Apertale，当前 manifest 版本 1.1.0，并注册八个 WebMCP 工具 | `app/site-manifest.json:2-13`；`app/src/authoringContract.ts`；`app/src/webmcp.ts` |
| 产品是 WebMCP 原生互动书籍画布，智能与模型用量来自用户自己的 Codex/ChatGPT 会话，不是网页内置的站点方 API key | `README.md:3-9`；`docs/PRODUCT_ARCHITECTURE.md:16-25` |
| 当前书库包含 Field Guide、Atlas、知识书、故事书和 Lantern Garden 五本独立书 | `app/src/sampleBook.ts:434-470` |
| 创作入口实际支持 Idea、Photos、Idea + photos；可选 4/6/8/10/12 跨页和四种风格 | `app/src/creationWorkshop.ts:10-19`；`app/src/App.tsx:1339-1438` |
| 照片驱动流程默认把照片作为故事事实和视觉参考；用户明确要求时允许 literal photo album | `app/src/creationBrief.ts:107-128`；`app/src/authoringContract.ts:41-44` |
| 创作工作台接受 PNG/JPEG/WebP；当前 UI 对不可用或超过 12 MB 的图片给出错误 | `app/src/App.tsx:880-905,1429`；`README.md:18` |
| 创建者书可 Publish and share，生成 Public link、Copy link 和只读 Open reader | `app/src/App.tsx:1277-1290`；`app/src/PublicationPanel.tsx:182-264`；`app/src/SharedBookApp.tsx:70-83,176-186` |
| 当前 ChatGPT Sites 根地址和保留分享页已验证；八工具部署、故事板、创建、发布和新分享链接须以录制前最后一次端到端结果为准 | `docs/CHALLENGE_READINESS.md:18-20,33-36`；`docs/SITE_TOOLS_ACCEPTANCE.md` |
| 官方模型叶子型号是 `gpt-5.6-sol`；正式显示名是 GPT-5.6 Sol | [OpenAI API — GPT-5.6 Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol) |
| 官方托管产品名是 Sites；Sites 可创建、托管、迭代和分享网站、Web app 与游戏 | [OpenAI — Sites](https://learn.chatgpt.com/docs/sites) |
| 官方能力名称是 Site tools；它是 ChatGPT 对拟议 WebMCP 标准的实现，并在内置 browser 中让 Codex 与人操作同一 live page | [OpenAI — Site tools (WebMCP)](https://learn.chatgpt.com/docs/webmcp) |
| 赛事要求公开的少于 3 分钟、带音频 demo video，并展示产品与 WebMCP 用法 | [OpenAI — The WebMCP Challenge](https://openai.com/webmcp-challenge/)；[Devpost — The WebMCP Challenge](https://webmcp.devpost.com/) |

## 仍需用户确认的最少事项

1. `[个人照片纪念册标题]`：录制时要打开哪一本真实照片成品；若没有，使用 `The Starlight Stitch` 并采用 `photo-led keepsake` 说法。
2. `[公开项目链接]`：结尾是否显示最终 Devpost/GitHub/Sites 链接；没有最终链接时只保留 Apertale 品牌收尾。
3. 若要把片头改成“**完全由 GPT-5.6 Sol 构建**”，请先确认完整历史模型来源。仓库能证明 Codex 深度参与，但现有 QA 也记录了其他模型的直接实现，因此主脚本使用了不排他的事实安全表述。
