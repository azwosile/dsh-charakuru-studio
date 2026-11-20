# Avatar Studio for DSH

**`v0.10.0` · 实验版（内部验证阶段，尚未进入公开分发宣传）。**

这是一个基于 MIT Clean-Room 协议实现的独立 DSH 角色制作工作台（npm 包名 `dsh-charakuru-studio`），面向**同机 DSH Desktop（`dsh-app://app`）**与**同机 DSH Web（`http://127.0.0.1:*` / `http://localhost:*` / `http://[::1]:*`）**提供从 2D 设定或本地可信素体到 VRM 1.0 的人机协作生产流水线。本插件不打开、内嵌或代理任何第三方闭源工具，也不随包分发专有角色模型。

---

## 核心能力与架构（`v0.10.0`）

- **3 主工作区 + 1 全局设置抽屉**：
  - **主工作台（Workbench）**：Canvas-First 布局，整合双路线切换（`01 原画重建` / `02 素体改型`）、6 关进度与人工审阅、离线 Three.js / VRM 1.0 视口（正侧背机位、3D 世界空间三视图参考平面、`Y=0` 身高标尺与 HUD、头身比/颈缩放实时校准与 Undo/Redo、内置 MIT/CC0 循环漫步 VRMA `builtin:walk`）、SpringBone ON/OFF 振荡审计触发、Clean-Room 表情实验室与无 Agent 一键写入 VRM 1.0 元数据导出。
  - **独立渲染台（Render Lab）**：锁定不可变 `.blend` 修订，由 DSH 会话内 Agent 通过 `charakuru_render` 拟定并运行本地渲染配方，自动适配 Blender 4.2 LTS–5.x `BLENDER_EEVEE_NEXT` / `BLENDER_EEVEE` 与 `CYCLES`、`Standard + Medium High Contrast`、Face SDF 阴影贴图、同时兼容 EEVEE 与 Cycles 的 `Solidify` 反法线描边、透视/正交镜头、景深、1080p/4K 与 `albedo`/`normal`/`depth` 辅助通道。
  - **资产库（Asset Library）**：统一管理原画、11 槽拆件图、Tripo 候选、素体 `.blend`、衣/发/饰 `.glb`/`.fbx`、贴图 `.png` 与动作 `.vrma`，自动适配 Desktop 原生路径桥与同机 Web 二进制流式上传。
  - **全局设置抽屉（Settings Drawer）**：集中配置 15 条 AA v2.1 图像模型参数与逐槽提示词模板、6 家云服务凭据与跨工程预算账本、Tripo 双通道、Blender 双通道诊断及同机 Web 本地目录浏览/新建（`/studio/fs/browse`、`/studio/fs/mkdir`）。
- **双建模路线与 25 项结构化建模工序**：
  - **路线 1（`illustration` 原画重建）**：原画导入 → 8+3 多视角拆件图 → Tripo 头/体候选 → Clean-Room 5 阶段管线 / Smart Mesh 5 组语义分割与 4K 去光重贴图 → 完整 `VRMC_materials_mtoon` → 骨骼权重/裙摆与发丝 VRM 1.0 `spring_bone1` → Clean-Room 表情实验室 → 内置漫步 VRMA 验收与无 Agent 元数据 VRM 1.0 导出。
  - **路线 2（`base_mesh` 素体改型）**：保留本地可信素体拓扑/UV/权重/表情键，支持 `fit_foundation` C¹ 分区域保头/保脚底改型与负值/多网格形态键同步、`append_foundation_head` 领口吸附与面部细骨保留、`normalize_material_mesh`（FBX/Draco GLB 规范化）、`fit_garment`（地标/掏空/去光/贴合/权重平滑/BVHTree 消穿模）、`rigid_attach`、增量 `spring_setup` 与多姿态 `pose_check`。
- **Blender 双通道混合协同**：
  - **通道 1（`dsh-blender-plugin` 契约层）**：对接 `3.0.6`（`9877`）与 `3.1 Gateway`（`39877`），支持 Headless / GUI `/act` 执行与 `/host/scene-items` 场景对象检索。
  - **通道 2（Agent Computer-Use GUI 签出/签入）**：通过 `checkout_gui` / `checkin_gui` / `abort_gui` 在工程隔离副本 `editor/working/<id>/scene.blend` 中自由手工精修并自动固化新修订，历史修订与原始 `.blend` 绝对只读。
- **Tripo 双通道架构**：
  - **OpenAPI v3**：独立余额查询、参数陷阱拦截、跨工程预算账本预留/对账、5 分钟签名 URL 即时下载归档、终态 `requestId` 禁复用与 `AbortController` 超时保护。
  - **多视角浏览器工单**：路线 1 绑定 4 张已审视图，路线 2 支持 1–4 张同部件参考 PNG，`confirm_quote` 返回回收目录并支持同机 Web 二进制上传。
- **平台兼容与安全加固（`v0.10.0`）**：
  - **Cordis 4 严格代理兼容**：Host（`lib/index.js`）与前端（`src/client-shell.js`）均保持数组形式 `inject`，所有可选服务通过安全封装读取，消除未注入属性访问崩溃。
  - **Blender 4.2 LTS / 5.x & Cycles 加固**：修复 `None in arm.data.bones`、`_smart_uv_project_object` `hide_viewport` + `temp_override`、`fit_garment` 复制笼体 `shape_keys` 崩溃、Cycles 反壳描边黑壳、多材质槽 `material_offset` 错位、非英文 UI `BSDF_PRINCIPLED` 查找与大小写无关 VRM 枚举写入。
  - **回环安全与前端修复**：畸形 `Host` 严格返回 `403`、全部 5 个二进制 GET 端点统一附带 `Referrer-Policy: no-referrer`、JSON 超限返回 `413`、目录新建拦截 Windows 保留设备名、修复 3D 三视图 `targetHeightM` 过期依赖与异步加载竞态，以及浅/深双主题与英文全视图零 CJK 审计。

---

## 六关全流程与人工审阅门禁

1. **`1_concept`（原画与设定）**：登记原画（独立版本化）或纯文字设定与预算上限。
2. **`2_views`（拆件图 / 素体规划）**：路线 1 产出 11 槽拆件与比例图；路线 2 采用素体并规划衣/发/饰部件。
3. **`3_tripo`（3D 候选生成与选定）**：通过 Tripo OpenAPI v3 或浏览器工单归档 `.glb`/`.fbx` 并在视口显式采用。
4. **`4_assembly`（装配与比例）**：执行素体改型/服装贴合/Smart Mesh 重贴图与穿模审计，绑定活动修订 SHA-256 送审。
5. **`5_rig_spring`（权重、弹簧与姿态探针）**：完成权重转移/归一化、`spring_setup`、`pose_check` 与 `physics_oscillation_audit` 后送审。
6. **`6_expressions_vrm`（表情与 VRM 1.0 交付）**：核对表情与许可元数据，经 `export_vrm` + 无 Agent 元数据修补导出 VRM 1.0，结合内置漫步 VRMA 与外部查看器终审。

> **全 6 关均采用哈希绑定的人工审阅**（`request_review` → 工作台人工批准或退回 → `reopen_stage`）；Agent 不能代用户批准交付或发起未经确认的云端扣费。

---

## 生图驱动与费用门禁

| 驱动选项 | 适配能力 | 默认安全边界 |
| --- | --- | --- |
| Qwen-Image-2.1 Local / Diffusers | 本地兼容端点文生图；导出离线 Diffusers 参考图编辑脚本 | 导出脚本不自动执行 |
| Qwen-Image-2.1 ComfyUI Edit | 校验并执行单参考图 ComfyUI 工作流（`resolution` 仅注入文本编码节点，不污染 `KSampler`） | 需本机配置 `comfyuiQwenWorkflowPath` 与权重 |
| Anima Base / Aesthetic / Turbo | 本机 ComfyUI 文生图工作流（双端强制 **16 的倍数**分辨率） | 内置图仅用于文生图 |
| NovelAI V5 / V4.5 | V5 文生图；V4.5 Precise Reference 参考图安全缩放填充 | 需用户显式确认云端单槽执行 |
| OpenAI / Google Gemini / 火山方舟 | `gpt-image-*` 透明背景、`nano-banana-2.1` 转 PNG、`seedream-5.5` 适配 | `allowCloudExecution` 默认关闭；单槽确认后调用 |
| 自配网关 (`openai_compat`) & AA 榜单 | 支持同机回环 `http://` 与远端 `https://` 兼容网关；收录 15 条 AA v2.1 目录 | 超时保留 `requestId` 对账，禁止换 ID 静默重发 |

---

## 文档导航

| 文档 | 内容说明 |
| --- | --- |
| [工作台使用指南](docs/WORKBENCH.md) | 3+1 工作区、双建模路线、6 关协作与安全门禁完整说明（`v0.10.0`） |
| [建模工序与双通道手册](docs/OPERATIONS.md) | 全部 25 项结构化 Blender 工序、独立渲染台配方、Blender/Tripo 双通道与常见故障排查 |
| [Windows / Electron 安装与升级指南](docs/INSTALL-WINDOWS.md) | 本地 `.tgz` 安装、同机 Web 配置、Blender/VRM 插件、回退与卸载说明 |
| [0.10.0 验证报告与诚实边界](docs/VERIFICATION-0.10.0.md) | 自动化单测、Python AST/`symtable`、零泄漏打包结果与待实机验证项清单 |
| [素材角色与格式规范](docs/MATERIALS-0.5.0.md) | 6 关素材角色定义、体积限制与二进制头校验规则 |
| [校验策略说明](docs/VALIDATION.md) | 静态/契约/回环与实机验收分层说明 |
| [Agent 操作规程 Skill](skills/charakuru-vrm-studio/SKILL.md) | 供 DSH Agent 加载的完整工具调用与安全边界规程 |

> 历史验证存档：[0.9.0](docs/VERIFICATION-0.9.0.md) · [0.8.0](docs/VERIFICATION-0.8.0.md) · [0.7.0](docs/VERIFICATION-0.7.0.md) · [0.6.1 历史界面指南](docs/WORKBENCH-0.6.1.md)。

---

## 本地安装与开发验收

- **目标环境**：DSH `0.2.2-rc.3` / Node `22+`，默认回环端口 `9886`，配合 `dsh-blender-plugin`（`9877` legacy / `39877` Gateway）、Blender 4.2 LTS / 5.x 及官方 VRM Add-on。
- **安装方式**：在 DSH 应用「插件 → 添加插件」选择本地打包的 `releases/dsh-charakuru-studio-0.10.0.tgz` 安装并启用（**严禁**对 `desktop` profile 运行 CLI `dsh plugin --profile desktop ...` 命令）。

```bash
npm ci --ignore-scripts --legacy-peer-deps --no-audit --no-fund
npm run build:client
npm run check
npm test
```

- 修改 `src/client-*.js`、`src/client-workbench.css` 或 `lib/client-preview.js` 后必须运行 `npm run build:client` 同步更新 `lib/client.js`。
- **当前自动化基线（`v0.10.0`）**：`npm run check` 全绿（62 个 JS/MJS + 10 个 Python AST + `lib/client.js` 逐字节同步 + `locale/en.json` 0 CJK）、8/8 Python 脚本 `symtable` 零未定义全局符号、`npm test` 放行回环实测 **124 项 — 123 通过 / 0 失败 / 1 跳过**（非提权 Windows 符号链接）。真实 Blender 4.2/5.x 与 DSH Desktop 实机回归仍需在安装有 Blender 与 DSH 的主机上逐项验证（详见 [VERIFICATION-0.10.0.md](docs/VERIFICATION-0.10.0.md)）。
- 内置离线 Three.js / `@pixiv/three-vrm` / `@pixiv/three-vrm-animation` 许可证声明见 [NOTICE](NOTICE)。
