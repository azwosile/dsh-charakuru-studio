# Avatar Studio for DSH

**0.6.1 · 实验版。** 这是一个独立的 DSH 角色制作工作台。参考 Charakuru 的人机交替流程，用 DeepSeek Harness 会话和本插件工具接力；不打开、内嵌、代理或启动原版，也不需要 Codex。保留原包名 `dsh-charakuru-studio`、工具 ID 和 `project.charastudio.json` 方便升级。与 DSH、Charakuru 或 Tripo 没有官方隶属关系。

## 两种制作模式

- **原画重建**：参照 Charakuru 的步骤栏、原画与同向头体图库、候选编号、正交/线框视口和右侧检查器。沿用六关、图像适配与手工费用门。
- **素体改型**：在本机选择同源素体和头模，保拓扑拉伸并调整已有形态键；把服装、发型和配饰拆成三个 Tripo 人工工单，下载后按角色追加。实查首选 YUMEKA 的 `Yumeka_Body` + `Body`；轻量备选 RINNE 不含完整脸。**不随包分发任何参考模型。**
- **独立 AI 渲染**：锁定活动 Blend 修订，在 DSH 会话中把镜头/打光交给 `charakuru_render`。Eevee 本机静帧独立对照、下载和审阅，不改模型或审批，也不调用云出图。

**本版变化**：塑形、对位和渲染由 DSH 会话内的 AI 先拟稿；图可换选或取消，不删素材。新增 Tripo 官方浏览器工单、文/图生图模式、按模型参数与可编辑的逐槽提示词。见 [0.6.1 使用指南](docs/WORKBENCH-0.6.1.md) 与 [0.6.0 历史设计](docs/WORKBENCH-0.6.0.md)。

## 原画重建六关

1. **原画和设定**：选择新工程，登记有权使用的 PNG。原画不占 11 槽；纯文生图可以只写角色设定，空概念不能送审。写清角色外观和用途；预算不明时填 0。
2. **拆件图**：在「模型与视图」选驱动和目标槽，查看用途、协议、提示词与预审。先做头/体的正面，再修正侧背；在「图片与模型库」用同方向头体对照图，另看三张全身比例图。`补做此图` 直接定位槽位。计划不会改进度；替代图先登记候选，手动导入与扫描不覆盖旧选择。
3. **头体候选**：使用已有合法自包含 GLB，或用官方浏览器工单分开确认图片上传、实际报价和手动提交后下载；预算预案只列真实、已批准的 8 张头体图路径。工作台记录报价或实际消耗、归档和指纹。预览并明确采用一头一体；归档不等于选定。
4. **装配与比例**：用 companion 对已审阅的候选做 Blender 前处理，再接过同工程检查点；已有 Blend 可直接导入独立修订。面板提供可离线加载的 Three.js/VRM 视口、正侧背相机、参考叠图、对象选择和回滚。
5. **权重、材料与动作**：保留已有 rig；显式物料检查、权重转移与归一化、humanoid、SpringBone/碰撞及姿态探针。不能用工具进程成功代替视觉检修。
6. **导出和复核**：导出 VRM 1.0 的结构或容器校验不等于最终交付。作者、使用条款、真实动作、外部查看器结果需独立核对；启发式 23 表情不是交付前提。

「制作工作台」和版本级「AI 修改请求」都能准备**当前 DSH 会话草稿**，不自动发送、不会代用户批准。用户发送后，Agent 用本插件技能与工具记录结果。未保留会话时，阶段指令可复制；已登记的版本修改可重新准备草稿。**前三关**有哈希绑定的审批；后三关有实验工序和版本审阅，尚不能在项目进度中标记为验收完成。

**外部素材**：六关各有「导入本步素材」。在 DSH 桌面从文件选择器、拖放或本机路径登记；显式采用原画/视图/候选，从 Blend、GLB 或 PNG 创建可回退的编辑修订，或将 VRM 1.0 和 VRMA 配对预览。详见 [六关素材表](docs/MATERIALS-0.5.0.md)。

## 生图与费用

| 选项 | 当前适配 | 默认边界 |
| --- | --- | --- |
| Qwen-Image-2.1 Local / Diffusers | 本地兼容端点文生图；导出 CUDA 参考编辑脚本 | 脚本不自动运行 |
| Qwen-Image-2.1 ComfyUI Edit | 导出并预审单参考 API 模板；在 loopback 上传、排队和领取 PNG | 需配置 `comfyuiQwenWorkflowPath`、服务与权重 |
| Anima Base / Aesthetic / Turbo | 本机独立权重工作流；按分支选 sampler/CFG | 内置图只做文生图 |
| NovelAI V5 / V4.5 | V5 multipart 文生图；V4.5 独立 Precise Reference | 社区协议，账号与收费未实测；V5 不传原画 |
| OpenAI Images / Google Gemini / 火山方舟 | 官方文档协议的文生图与单参考编辑 | 账号、地区、材料上传和实际费用须单独核对 |
| 自配网关；其他榜单模型 | 网关可配置 HTTPS 文生图 (PNG `b64_json`)；目录项可导出提示词 | 不根据榜名猜路由/模型 ID，不追随下载 URL |

`allowCloudExecution` 默认关闭。付费路径只在用户从工作台确认单槽、明确 API ID 与凭据后调用；Agent 可以规划、导出或运行明确获准的本机模型，但不会自动发付费请求。不得将超时当作未扣费。保留请求 ID，核对旧回执和供应商记录后才换 ID。账户账本手工维护，不能拦截外部消费；Studio 与 OpenAPI 分账，公开性和商业权以实际账户与现行条款为准。

详细步骤、配置和核验边界见 [0.4.0 原生流程](docs/WORKFLOW-0.4.0.md) · [建模工序](docs/OPERATIONS.md) · [安装、升级与卸载](docs/INSTALL-WINDOWS.md) · [0.6.0 验证](docs/VERIFICATION-0.6.0.md) · [0.5.0 外部素材验证](docs/VERIFICATION-0.5.0.md)。

## 安装与开发

目标 DSH 0.2.2-rc.3 / Node 22+。Electron 应用从「插件 → 添加插件」用本地 `dsh-charakuru-studio-0.6.1.tgz` 安装并启用。同机网页端与桌面端使用同一客户端席位契约。见安装指南中的连接与验收边界。不要用 CLI 改 desktop profile。工作台默认 HTTP 回环端口 9886，另装 companion、Blender 和 VRM Add-on。现有 9877 legacy companion 与 3.1 Gateway 分开探测，后者需要真实 DSH execution 上下文，不能由面板伪造。

```bash
npm ci --ignore-scripts --legacy-peer-deps --no-audit --no-fund
npm run build:client
npm test
npm run check
```

修改 `src/client-*.js`、`src/client-workbench.css` 或 `lib/client-preview.js` 后重建 `lib/client.js`。插件内置离线 Three.js / three-vrm / three-vrm-animation，许可证见 [NOTICE](NOTICE)。MIT 仅覆盖本仓库原创代码及相应依赖，不授予第三方代码、模型权重、服务或角色使用权；不分发受限原版实现、donor、用户资产或凭据。
