# Avatar Studio for DSH · 工作台使用指南（v0.10.0 实验版）

> 本文档面向 `v0.10.0` 内部实验与实机验证阶段，覆盖当前 **3 主工作区 + 1 全局设置抽屉** 界面与双路线（原画重建 / 素体改型）完整操作流程。历史 `0.6.1` 九标签说明保留于 [WORKBENCH-0.6.1.md](WORKBENCH-0.6.1.md)。

---

## 1. 界面结构（3 主工作区 + 1 全局设置抽屉）

安装并启用插件后，从 DSH 左侧边栏进入 **Avatar Studio**：

1. **主工作台（Workbench）**：Canvas-First 布局，面向日常建模、审阅与交付：
   - **顶部栏**：切换建模路线（`01 原画重建` / `02 素体改型`）、查看当前活动工程与 6 关进度状态。
   - **中央离线 3D / 图像视口**：内置离线 Three.js + `@pixiv/three-vrm` + `@pixiv/three-vrm-animation` 视口，支持正/侧/背快速机位、**3D 世界空间三视图对齐平面**、**`Y=0` 脚底对齐与身高米尺 HUD**、**头身比/颈缩放实时联动校准（含 24 步 Undo/Redo）**以及 **内置 MIT/CC0 循环漫步动作（`builtin:walk`）**与自定义 `.vrma` 播放。
   - **右侧精简检查器**：按当前阶段展示对应表单——包含原画/素体登记、视图生成/采用、Tripo 候选对比、AI 结构化编辑草稿（插入 DSH 对话框而非越权直跑）、Blender 通道切换（`auto` / `plugin` / `computer_use`）与 GUI 签出/签入控制、**SpringBone ON/OFF 抖动审计卡片**、**Clean-Room 表情实验室**以及**无 Agent 一键写入 VRM 1.0 元数据导出卡片**。
2. **独立渲染台（Render Lab）**：
   - 锁定当前工程的不可变 `.blend` 修订，由你在工作台发起渲染诉求，交由 DSH 会话内 Agent 调用 `charakuru_render` 拟定并执行镜头/材质/灯光配方（支持 Blender 4.2 LTS–5.x `BLENDER_EEVEE_NEXT` / `BLENDER_EEVEE` / `CYCLES`、`Standard + Medium High Contrast`、Face SDF 贴图、安全 `Solidify` 反壳描边、透视/正交镜头、景深、1080p/4K 与 `albedo`/`normal`/`depth` 辅助通道）。
   - 摘要栏直接呈现 `engine`、`viewTransform`、`lensType`、`toonMaterials`、`outlineMeshes`、`faceSdfMaterials`，渲染结果独立于建模审阅记录。
3. **资产库（Asset Library）**：
   - 统一浏览、导入、预览和采用当前工程的原画、11 槽拆件图、Tripo 候选、素体 `.blend`、服装/发型/配饰 `.glb`/`.fbx`、贴图 `.png` 与动作 `.vrma`。
   - **同机 Desktop 与同机 Web 自动适配**：DSH Desktop（`dsh-app://app`）优先使用原生路径选择桥；同机 DSH Web（`127.0.0.1` / `localhost` / `[::1]`）无缝切换为浏览器二进制流式上传。
4. **全局设置抽屉（Settings Drawer）**：
   - 管理工作台回环地址与端口（默认 `9886`）、同机 Web 目录浏览与新建（`/studio/fs/browse`、`/studio/fs/mkdir`）、15 条 AA v2.1 图像模型参数与逐槽提示词模板、6 家云服务凭据（仅写入 DSH Host 凭据存储，不在前端明文回显）、跨工程预算账本、Tripo 双通道设置与 Blender 伴随诊断（`9877` legacy / `39877` Gateway）。

> **主题与语言**：界面全面跟随 DSH 浅色/深色主题变量，3D 与图片画布固定深色中性底以保色准；支持中英文实时切换，英文模式全视图零 CJK 泄漏。

---

## 2. 双建模路线与 6 关人机协作流程

| 阶段 | 路线 1：`illustration`（原画重建） | 路线 2：`base_mesh`（素体改型 + Tripo 衣/发/饰） | 审阅门禁 |
| --- | --- | --- | --- |
| **1. `1_concept`** | 登记原始角色原画（独立版本化）或纯文字设定与预算上限 | 登记目标形象参考图与改型说明 | 人工审阅原画与设定 |
| **2. `2_views`** | 生成或导入头部 4 视图 + 身体 4 视图 + 3 张全身比例图（共 11 槽，支持单槽重修） | 登记并采用本地可信素体 `foundation_body`（可选 `foundation_head`），规划衣/发/饰并准备每部件 1–4 张多视角参考 PNG | 人工审阅 11 槽 / 素体规划 |
| **3. `3_tripo`** | 通过 Tripo OpenAPI v3 或浏览器工单生成头/体 3D 候选并在视口对比采用 | 按部件通过 Tripo OpenAPI v3 或 1–4 视角浏览器工单生成衣/发/饰 `.glb`/`.fbx` 并回收归档 | 人工审阅 3D 候选 |
| **4. `4_assembly`** | Clean-Room 装配、Smart Mesh 5 组分割与 4K 重贴图、3D 三视图 & `Y=0` 标尺校准、MToon 材质 | `import_material_scene` → `fit_foundation`（C¹ 分区域保头/保脚底改型 + 负值/多网格形态键）→ 可选 `append_foundation_head` → `normalize_material_mesh` → `fit_garment` → `audit_penetration` | 绑定修订 SHA-256 送审 |
| **5. `5_rig_spring`** | 骨骼权重绑定与归一化、径向裙摆与发丝 VRM 1.0 `spring_bone1`、多姿态与 SpringBone ON/OFF 振荡审计 | `transfer_weights` / `normalize_weights` / `rigid_attach`、`spring_setup`（默认 `append` 保留原有弹簧）、`pose_check` 与 `physics_oscillation_audit`；可随时 `checkout_gui` 切入桌面 Blender 手工精修后再 `checkin_gui` | 权重/物理/姿态证据送审 |
| **6. `6_expressions_vrm`** | Clean-Room 表情实验室（发/脸包围盒分离生成形态键并直绑 VRM 1.0）→ `export_vrm` → 无 Agent 一键修补元数据导出 `.vrm` + `builtin:walk` 预览 | 核对原有表情键与元数据 → `export_vrm` → 无 Agent 一键元数据修补导出 `.vrm` + `builtin:walk` 与外部 VRM 查看器终审 | 最终 VRM 产物终审 |

---

## 3. 安全边界与费用门禁（核心原则）

- **零消费默认（`allowCloudExecution = false`）**：未在插件设置显式开启云端执行且未经你单次报价/槽位确认时，不会向任何外部云端生图或 Tripo OpenAPI 发起付费请求。
- **幂等防重发**：所有付费调用均受 `requestId` 与跨工程预算账本（`account-budget.js`）保护；网络超时或状态未明（`uncertain`）时冻结对应预留额度等待人工对账，禁止换新 `requestId` 静默重试；已取消或失败的终态 `requestId` 不可复用。
- **不可变修订与只读保护**：用户原始外部 `.blend` 与历史 `editor/revisions/<id>/` 永远只读；桌面自由编辑须通过 `checkout_gui` 在隔离副本 `editor/working/<checkoutId>/scene.blend` 中完成。
- **人工审批权不可让渡**：Agent 工具可以准备草稿、运行结构校验与本地渲染，但**不能**替用户点击审阅通过或花费积分。

---

## 4. 延伸阅读

- 结构化 25 项 Blender 工序、独立渲染台配方与双通道故障排查：[OPERATIONS.md](OPERATIONS.md)
- Windows / Electron 与同机 Web 安装、升级、回退与卸载：[INSTALL-WINDOWS.md](INSTALL-WINDOWS.md)
- 当前版本实测结果与诚实边界：[VERIFICATION-0.10.0.md](VERIFICATION-0.10.0.md)
- 素材角色分类与格式校验细则：[MATERIALS-0.5.0.md](MATERIALS-0.5.0.md)
- 自动化校验策略说明：[VALIDATION.md](VALIDATION.md)
