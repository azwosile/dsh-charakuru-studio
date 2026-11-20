---
name: charakuru-vrm-studio
description: 使用独立角色工作台（Avatar Studio for DSH v0.10.0 实验版）管理 2D 原画重建与 Route 2 素体改型双路线 VRM 工程、编译 11 视图提示词、导出生图工作流、双通道调度 Tripo（OpenAPI v3 + 多视角网页工单）并通过 Blender 双通道（25 项结构化建模工序、Smart Mesh 4K 重贴图、MToon 材质、Clean-Room 表情实验室、物理 ON/OFF 抖动审计、NPR/Cycles 渲染台、Agent GUI 签出/签入与无 Agent VRM 元数据一键导出）执行建模与独立渲染。
---

# 角色工程操作规程（v0.10.0）

先读取 `charakuru_project(action="status", projectDir=...)`。工程尚未创建时使用 `action="init"`，填写角色描述和账户实际月额度。所有工具明确传入 `projectDir`；默认目录固定，不随其他会话切换。可通过 `set_workflow_mode`、`select_foundation`、`plan_tripo_parts`、`import_material` 管理路线切换与物料导入。

## 0.10.0 · Blender 4.2/5.x 与 Cycles 兼容加固、安全与视口修复（继承 0.9.0 全部功能）

- **5 项 Clean-Room 阶段脚本修复（`lib/blender/cleanroom-scripts.js`）**：
  - `stage1_safe_import`：排除 `headless` 命名体，不再将 `headless_body` 误判为头部网格。
  - `stage3_rig_weights`：激活 `fix_mixamo_pinky_drift`、补全指/眼/趾骨逻辑，并强制左右腿 X 符号权重隔离防止交叉串扰。
  - `stage4_skirt_springs`：修复 Blender `-Y` 前向下的裙摆前锚角度计算（`angle=0` 对应 `0°` 而非 `180°`），并实现真实 VRM 1.0 `spring_bone1` 碰撞体组与发束/裙摆弹簧链 wiring。
  - `stage5_expressions_vrm`：修复 `preset.happy`（同时绑定左右眼与 `mouth_smile`）并完整绑定 23 个表情键，同时在头部包围盒计算中排除头发顶点避免面部偏移。
- **工作台 3D 校准、内置 VRMA 与无 Agent 元数据导出**：
  - 3D 世界空间三视图平面（`balance_front` / `balance_right` / `balance_back` 锚定 `Y=0` 地面）与 `Y=0` 身高标尺（含头身比/颈缩放联动及撤销/重做）。
  - 内置 MIT/CC0 循环漫步参考（`GET /studio/motions/builtin` → `assets/motions/cleanroom_walk_loop.vrma`）。
  - **无 Agent 一键写入 VRM 元数据并导出（`POST /studio/vrm/export-meta`）**：通过 `lib/vrm/metadata-patcher.js` 原位修补 GLB 2.0 `VRMC_vrm` 1.0 JSON 块并逐字节保留 BIN 网格数据。
  - **Clean-Room 表情实验室接力**：工作台支持选择眨眼/口型/情绪预设以 `intent: "expressions"` 触发 `expression_lab` 草稿；`validateEditorParams` 已放行 `expressions: "expression_lab"`。

## 0.8.0 · Route 2 素体全栈工序、NPR 渲染台与双通道接力

- **AI 协作草稿与修订绑定**：工作台交接到当前 DSH 会话的是草稿，用户发送才作业。建模先调用 `charakuru_blender_avatar(action="editor_inspect", projectDir, editRequestId)` 读取绑定修订的实际对象、形态键（含 `sliderMin` / `sliderMax`）、骨架与供体清单（无 `editRequestId` 时可只读审查当前活动修订；也可以用 `list_materials` 查看已登记物料）。随后按自然语言目标自行拟定结构化参数，调用 `editor_operation`（携带 `editRequestId` 与 `expectedRevisionId`）或双通道动作，不要让用户代填 XYZ、旋转角、骨骼名或形态键；遇到无法安全判断的审美或授权再问。支持 `editor_rollback` 回退到任意已验证的历史修订。
- **双制作路线（`illustration` 与 `base_mesh`）**：
  - `illustration`（原画重建）：原画与设定 → 8+3 多视图生成 → Tripo 头/体候选生成与对比 → Blender 装配/比例 → 骨骼权重与物理弹簧 → 表情与 VRM 1.0 导出。
  - `base_mesh`（Route 2 素体改型）：先登记并采用 `foundation_body`（及可选 `foundation_head`）再通过 `import_material_scene` 创建起始修订。
    - `fit_foundation`：保留已有权重、UV 与拓扑，支持有界 `scale`（`applyScale` 烘焙缩放并清理 `Studio_FoundationFit*` 空物体）、正负值 `shapeValues`（`[-10..10]`、可选 `mesh`、跨 `syncMeshes` 同步写入）与 C1 连续局部 `regionScaling`（`preserveHead`、`legScale`、`torsoScale`、`shoulderWidthScale`、`waistScale`、`hipScale`、`armScale` 等）。
    - `append_foundation_head`：必须先等 `editor_inspect` 返回供体清单（含 `armatures`、`facialBones`、`neckRimEstimate`；`donorPending` 时同一调用收集），使用已采用的 `foundation_head` 与有界 `scale`/`translation`/`rotation`，可选 `snapNeckRim` / `snapTolerance` 吸附颈缘及 `preserveFacialBones` 保留供体面部骨；不猜对象名。
    - `normalize_material_mesh` / `append_material_mesh`：支持 `.glb`/`.gltf` 与 `.fbx`（解包变换、单位自适应、`rotateZDeg`、`targetHeight`、`groundToFloor`、`pack_all()`，规范化时另导出未压缩 `normalized.glb`）。
    - `fit_garment`、`audit_penetration`、`rigid_attach`：针对衣/发/饰执行地标对位/去内胆/去光照/`shrinkwrap`/`surface_deform`/`mesh_deform_cage` 贴合、重量平滑与穿模推离；通过 `BVHTree` 在 `rest` 及多姿态下审计或推离穿模（自动忽略 `Outline`/`SOLIDIFY` 修饰器）；对刚性配饰按 `bone_parent` 或 `vertex_weight` 绑定到显式骨或语义解析人形骨。
    - `apply_material_texture`：将 `texture_sheet` PNG 绑定到显式材质槽并打包。编辑后由用户在工作台批准或退回，Agent 不代审。
- **独立 AI 渲染台（`charakuru_render`）**：调用 `charakuru_render(action="status", projectDir, requestId)`（或 `action="list"` 查看历史渲染请求）核对绑定修订和人类要求，再用 `action="run"` + `expectedRevisionId` + 自行拟定的 `recipe`。镜头（`camera`）、取景（`framing`）、尺寸（`size`，支持 `draft`/`review`/`wide`/`hd1080`/`portrait1080`/`uhd4k`/`portrait4k`）和配色（`preset`）必填；`preset="custom"` 可设受界 `lighting`。v0.8.0 支持 `engine`（`'eevee'|'cycles'`，自动兼容 Blender 4.2 LTS–5.x 的 `BLENDER_EEVEE_NEXT` / `BLENDER_EEVEE` / `CYCLES`）、`lensType`（`'ortho'|'persp'`）、`lens`、`dof`、`yawDeg`、`pitchDeg`、`transparent`、`samples`、`frame`、`viewTransform`（Toon 默认 `'Standard'`）、`look`（Toon 默认 `'Medium High Contrast'`）、`toonOptions`（含 `outline`、`outlineThickness`、`outlineColor`、`faceSdf`、`faceSdfMaterialId` 须为工程已登记 `.png`、`specularRim`、`metallicStep`）与 `passes`（`albedo`/`normal`/`depth`）。返回 `queued` 时在同一 DSH 执行上下文调用 `charakuru_render(action="collect", projectDir, requestId)` 收集结果，超时核对回执而非换 ID 重发；未完成时可使用 `action="cancel"`。产出的 PNG 由用户单独审阅，不改动模型修订或关卡状态。

## 六个关卡与全流程门禁

1. `1_concept`：明确外观设定、预算、偏好模型与工程内参考图（或纯文生图设定）。
2. `2_views`：头部四视图、身体四视图、全身比例三视图（共 11 槽，或 `base_mesh` 路线下的素体与部件规划）。头部闭口且无遮挡，身体水平 T-pose；对齐眼线、肩线、胯线和鞋底。
3. `3_tripo`：通过 Tripo 双通道生成或归档头/体/衣/发/饰候选 GLB/FBX，并在工作台预览采用。
4. `4_assembly`：导入检查点或素体场景、部件规范化与追加、素体局部缩放、服装贴合、穿模审计与结构贴图审计（绑定活动 `editor.revisions` 的 Blend/GLB/Audit SHA-256）。
5. `5_rig_spring`：骨架权重转移与归一化、刚性附件绑定、VRM humanoid 骨骼映射、多模式 SpringBone（默认 `append` 保留原有发饰/胸春骨，连续插值裙摆并使用 `group.remove` 清理旧权重）及多语义骨骼解析姿态探针（0-骨匹配立即报错阻断）核验（`gates.weights` 与审计证据通过）。
6. `6_expressions_vrm`：表情与 VRM 元数据配置（Title/Authors/许可证）、`export_vrm` 导出 VRM 1.0 容器并同步 `vrmMetadata.exportedVrmPath`。

**全 6 关均支持提交审阅**：完成任一阶段（`1_concept` 至 `6_expressions_vrm`）且证据或活动编辑修订就绪后，均可调用 `charakuru_project(action="checkpoint", checkpointAction="request_review", stageId=..., projectDir=...)` 提交证据（或用 `reopen_stage` 重新打开修订）。所有图像、GLB 与 Blend 修订均由 SHA-256 指纹绑定审阅，变更后必须重新审批。用户在「Avatar Studio 工作台」批准或要求修改；禁止将脚本进程成功替代人工视觉验收，也严禁借本地 HTTP session token 绕过用户审阅。

## 生图与预算门禁

`charakuru_aa_models(action="leaderboard")` 查询静态 AA v2.1 榜单与适配状态；`action="compile_prompts"` 编译逐槽提示词（传入 `projectDir` 时自动合并项目保存的 `imageProfiles` 自定义模板）。基准名次不是接口、费用或视觉质量凭证。

`charakuru_generate_views` 支持 `action="preflight"`、`action="get_profile"`、`action="save_profile"` 与 `action="generate"`（默认为导出预案 `mode="plan"`）。实际本机 `mode="execute"` 要求稳定的 `requestId`、真实启动的本地服务和用户明确需求；重试同一任务时必须保持 `requestId` 不变，新 ID 代表新任务。传 `imageMode="text_to_image"` 或 `"image_to_image"`，后者缺少工程参考 PNG 时直接失败，绝不静默丢弃参考图退回文生图。

- **Qwen**：Diffusers 离线脚本支持参考图；通用兼容 HTTP 文生图不传原画。`qwen-image-2.1-comfy-edit` 需要 `comfyuiQwenWorkflowPath` 和一张工程原画。
- **Anima**：内置工作流仅用于文生图（`image-profiles.js` 与 `buildAnimaComfyWorkflow` 双端强制 **16 的倍数**分辨率，范围 64–2048 / 16–16384）。Aesthetic 正负提示均去 `score_*`；Turbo 使用独立模型、CFG 1 / 8 步。
- **云端与网关**：`allowCloudExecution` 默认关闭。NovelAI V5 实验协议不传参考图，V4.5 Precise Reference 单独选卡；官方 OpenAI (`gpt-image-*`)、Google Gemini (`nano-banana-2.1`)、火山方舟 (`seedream-5.5`) 与自配网关（`openai_compat`）凭据独立（通过 `charakuru_credentials` 检查状态，不回显明文密钥）。付费云端生图只能由用户在工作台单槽确认后启动，Agent 工具不自动派发付费云端生成；超时或状态未明时保留 `requestId` 对账，不换 ID 重发，也不自动切换服务。

## Tripo 双通道（OpenAPI v3 × 浏览器多视角工单）

`charakuru_tripo_quota` 同时支持规划、OpenAPI v3 与网页浏览器接力双通道，共用不可变候选库与独立账本（Studio 网页额度与 OpenAPI 余额严格分账）：

1. **通道 A：Tripo OpenAPI v3**：
   - `action="openapi_balance"`：零成本实时查询独立 OpenAPI 账户余额。
   - `action="openapi_submit"`：在 `allowCloudExecution=true`、用户显式确认报价且绑定 `requestId` / `expectedRevision` 与预算预留（`reserve`）后，上传授权 PNG 并提交 `image_to_model`、`multiview_to_model`（至少 2 张且必含 `front`）或后处理任务。遵守参数防呆铁律：需要后处理（贴图/绑定/转换）时禁止设置 `export_orientation`；`generate_parts=true` 与 `texture`/`pbr`/`quad`/`smart_low_poly` 互斥。网络超时或状态未明时转入 `uncertain` 并保留 `taskId` 对账，严禁换 ID 自动重试。
   - `action="openapi_poll"`：轮询 `GET /v3/tasks/{task_id}`；一旦状态为 `success`，遵循 **5 分钟 URL 时限铁律**立即下载并校验归档到工程候选库，完成预算结算（`settle`）。
2. **通道 B：浏览器多视角人工工单与本地归档**：
   - `action="studio_status"` 读取工单（路线 1 绑定 4 张已审视图；路线 2 `base_mesh` 支持绑定 **1–4 张**同部件多视角参考 PNG `referenceMaterialIds`）。
   - 仅使用用户明确授权的已登录标签页和 `https://studio.tripo3d.ai/`；`upload_authorized` 前不得上传；报告实际报价并经用户 `confirm_quote`（直接返回 `inbox` 回收目录）后由用户点击 Generate。支持桌面原生路径与同机 Web 二进制上传（`POST /studio/tripo/studio/upload`），下载后用 `action="studio_collect"` 或 `action="archive_glb"`（支持 `head`/`body`/`clothing`/`hair`/`accessory`）校验归档。归档或导入不等于采用，由用户在资产库预览并选定候选。

## Blender 双通道与混合接力规则

先调用 `charakuru_blender_avatar(action="probe", projectDir=..., sceneQuery=...)` 探测实际协议（自动识别 legacy 3.0.6 `9877` 与 3.1 Gateway `39877` 及 `/host/scene-items` 实时场景对象，禁止从端口猜测协议版本；多桥接冲突须先处理）。所有 Blender 打开操作均遵循 VRM-first 发现机制，在 `open_mainfile` 前启用官方 VRM Add-on。

### 通道 1：`dsh-blender-plugin` 契约层与结构化脚本（Headless / GUI `/act`）
- **适用场景**：批量参数化建模工序、结构化装配、权重转移、VRM 导出与离线多机位 Eevee/Cycles 渲染。
- **工具协同与版本映射**：
  - 优先读取 `blender-modeling` 技能并协同使用 `dsh-blender-plugin` 的契约层（`catalog`、`asm_*`、`img_*`、`visualreport`、`gate_*`、`deliver_export`）。
  - 在 3.0.6 环境对应 `blender_rt_plan`、`blender_rt_do`、`blender_rt_script`、`blender_rt_txn`（GUI 修改前打事务快照以便出错回滚）、`blender_rt_see`（抓取多视角实时截图）、`blender_rt_job`；在 3.1 Gateway 环境对应 `blender_op`、`blender_run`、`blender_py`、`blender_session(action="txn")`、`blender_see`（3.1 GUI 执行需传入已 attach/grant 的 `sessionId`，身份由真实 DSH execution 上下文提供）。
  - 通过 `charakuru_blender_avatar` 提交的阶段或编辑器异步作业返回 `jobId` 时，**必须分别使用 `charakuru_blender_avatar(action="collect_job")`（针对 `run_stage`）或 `charakuru_blender_avatar(action="editor_collect")` / `editor_cancel`（针对 `editor_operation`）收集并落盘到工程检查点/修订树**；渲染队列使用 `charakuru_render(action="collect")`。

### 通道 2：Agent Computer-Use（桌面 GUI 签出 / 签入协议）
- **适用场景**：契约层难以覆盖的自由手工微调，如 Sculpt 笔刷推平穿模、Weight Paint 逐顶点刷权重、局部拓扑补洞、复杂 Shader 节点连线或第三方 Blender 插件交互。
- **标准三步协议**：
  1. `charakuru_blender_avatar(action="checkout_gui", projectDir, expectedRevisionId, note)`：校验基线修订与 SHA-256，获取工程 `guiLock`，将源 `.blend` 拷贝至隔离工作区 `editor/working/<checkoutId>/scene.blend`（保护 `editor/revisions/` 与用户源 `.blend` 100% 只读）。
  2. Agent 通过桌面 Computer-Use 在 Blender GUI 中打开并编辑 `editor/working/<checkoutId>/scene.blend`，原位保存（期间锁定并发 `editor_operation`）。
  3. `charakuru_blender_avatar(action="checkin_gui", projectDir, checkoutId, expectedRevisionId, exportVrm=...)`：通过 companion 自动执行打包贴图（`pack_all`）、导出 `preview.glb`（及可选 `avatar.vrm`）、运行 `audit()` 并计算全产物 SHA-256，固化为新的不可变修订 `editor/revisions/<newId>/` 后释放 `guiLock`。若放弃草稿则调用 `action="abort_gui"` 清理工作区并释放锁。
- **混合接力与偏好切换**：两条通道共享同一套 `editor.revisions[]` 修订树，可在同一角色上分段交替使用；可通过 `action="set_channel_preference"` 在 `auto`（自动择优）、`plugin`（优先插件契约）与 `computer_use`（优先 GUI 桌面操控）之间切换。

### 完整工序与阶段清单

- **结构化编辑器工序（`action="editor_operation"`，25 项 `editorOperation`）**：
  - 导入与物料接力：`import_blend`（导入用户选定 `.blend`）、`import_checkpoint`（接力本工程已指纹登记的 Blender 检查点）、`import_material_scene`（从已采用的 `foundation_body` 或 `assembly_scene` 创建起始修订）、`normalize_material_mesh`（导入并规范化 `.glb`/`.gltf`/`.fbx` 物料网格、单位与朝向，可选导出 `normalized.glb`）、`append_material_mesh`（追加 `tripo_clothing`/`tripo_hair`/`tripo_accessory`/`accessory_mesh` 的 `.glb`/`.gltf`/`.fbx` 网格并支持规范化选项）、`apply_material_texture`（将 `texture_sheet` PNG 应用到目标网格材质 Base Color）。
  - 素体与几何变换：`fit_foundation`（保持素体拓扑、UV 与权重的有界 `scale` + `applyScale` + 正负值跨网格 `shapeValues` + C1 连续 `regionScaling` 塑形，清理 `Studio_FoundationFit*`）、`append_foundation_head`（将已验证 `foundation_head` 供体头部网格按 `headBone`、`replaceHeadObjects`、`scale`/`translation`/`rotation` 及可选 `snapNeckRim`/`preserveFacialBones` 对位绑定）、`head_scale`（头骨及子骨联动缩放 `0.75..1.25`）、`transform`（对显式网格执行有界 `scale`、`translation` 与欧拉角 `rotation` `[-360..360]` 变换）。
  - 服装贴合、穿模、重贴图与刚性绑定：`fit_garment`（对衣/发/饰执行地标缩放、去内胆、去高光/`shrinkwrap`/`surface_deform`/`mesh_deform_cage` 贴合、权重平滑与穿模推离）、`smart_mesh_retexture`（按连通孤岛与语义高度分组为 `hair`/`head`/`upper_body`/`lower_body`/`accessories` 并执行 Smart UV 与 4K/2K/1K 贴图烘焙/投影打包）、`audit_penetration`（基于 `BVHTree` 的 `rest` 及多姿态穿模审计与可选推离，忽略 `Outline`/`SOLIDIFY`）、`rigid_attach`（将刚性配件按 `bone_parent` 或 `vertex_weight` 绑定到指定骨或语义解析人形骨）。
  - 审计、材质、物理、表情与绑定导出：`audit`（网格/骨架/形态键含 `sliderMin`&`sliderMax`/缺失贴图/权重/SpringBone 结构审计）、`materials`（`preserve`、`pbr` 或 `mtoon` 模式）、`apply_mtoon`（完整 `VRMC_materials_mtoon` 阴影/MatCap/边缘光/描边配置与 ShaderNode 回退）、`transfer_weights`（从显式同工程 `sourceMesh` 求值表面按 `maxTransferDistance` 采样转移变形骨权重）、`normalize_weights`（归一化变形骨权重并拦截零权重点）、`configure_vrm`（配置 VRM 1.0 humanoid 骨骼映射与作者/权限元数据）、`spring_setup`（支持 `append`/`replace`/`strict` 模式的 SpringBone 链条、世界空间碰撞体胶囊及连续双线性插值裙摆骨架）、`pose_check`（多语义骨骼解析 + 0-骨失败阻断 + 多姿态高抬腿与截屏探针）、`physics_oscillation_audit`（SpringBone ON vs OFF 摆幅与 `BVHTree.overlap()` 穿模对比）、`expression_lab`（Clean-Room 独立表情形态键生成与 VRM 1.0 绑定，隔离长发顶点）、`export_vrm`（权重与纹理门禁核验后导出 VRM 1.0 `avatar.vrm` 并更新 `exportedVrmPath`）。
- **Clean-Room 启发式阶段脚本（`action="run_stage"`）**：
  - `stage1_safe_import`、`stage2_assembly_ratio`、`stage3_rig_weights`、`stage4_skirt_springs`、`stage5_expressions_vrm`。其中阶段 2–5 返回 `degraded`，表示启发式草案需独立检查与人工视觉验收；进程 `ok` 或容器扩展存在不等于成品交付，须结合审计、姿态探针与外部 VRM 查看器共同验收。
