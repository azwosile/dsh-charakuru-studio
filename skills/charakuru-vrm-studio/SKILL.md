---
name: charakuru-vrm-studio
description: 使用独立角色工作台管理 2D 到 VRM 工程、编译 11 视图提示词、导出生图工作流、规划 Tripo 预算并通过伴随插件运行 Blender 草稿脚本。适用于角色拆件、多视图、GLB 归档和 VRM 制作辅助；骨架、裙摆和表情效果需人工验收。
---

# 角色工程操作规程

先读取 `charakuru_project(action="status", projectDir=...)`。工程尚未创建时使用 `action="init"`，填写角色描述和账户实际月额度。所有工具明确传入 `projectDir`；默认目录固定，不随其他会话切换。

## 0.6.0 双路线与渲染接力

- 原画重建沿用六关。本机 `base_mesh` 另走素体与头模选择；工作台采用已登记的 `foundation_body` 后，才用 `import_material_scene` 打开审计。已有权重和脸必须优先保留。`fit_foundation` 指定 bodyObject、armature、相对 scale、已有 shapeValues；`append_foundation_head` 另需已采用的 `foundation_head`、明确网格名和头骨，只实验性刚性头骨跟随。绑定活动 `expectedRevisionId`；不声称自动颈缝、眼动或表情匹配。
- 素体路线只对衣、发、饰做人工工单，不上传素体/头模/工程，不跨用账本。回来的单件自包含 GLB 按角色登记、追加、定位、重查权重。
- 渲染从独立渲染台登记请求：`charakuru_render(action="status", projectDir, requestId)` 核对要求和底图修订；再用 `action="run"`、`expectedRevisionId` 与给定 `recipe` 调整本机静帧。只允许枚举镜头、布光及有限系数。不能使用对话里的任意 Python/路径代替渲染工具，不上传，不修改 Blend。返回 `queued` 时由提交的 execution 调 `collect`，超时先对回执、不重发。颜色与构图由用户单独批准/退回；Agent 无此动作。

## 六个关卡

1. `1_concept`：明确外观、预算、模型、参考图与交付要求。
2. `2_views`：头部四视图、身体四视图、全身比例三视图。头部闭口且无遮挡，身体水平 T-pose；对齐眼线、肩线、胯线和鞋底。
3. `3_tripo`：生成手动 Studio 操作计划，用户网页提交、下载 GLB 并归档。
4. `4_assembly`：导入、比例草稿、对象分组、多角度检查。
5. `5_rig_spring`：启发式骨架权重与裙摆骨架草案；人工配置弹簧、碰撞体和服装权重。
6. `6_expressions_vrm`：表情草稿、元数据与导出尝试；检查位移、预设绑定、动作及查看器表现。

完成当前阶段后用 `charakuru_project(action="checkpoint", checkpointAction="request_review", ...)` 提交证据。Agent 工具支持提交审阅和恢复编辑；用户在侧栏「Charakuru 工作台」批准或要求修改。逐关推进，禁止将脚本执行成功替代人工验收。

## 生图

`charakuru_aa_models(action="leaderboard")` 查询 2026-11-18 静态 AA v2.1 榜单与适配状态；`action="compile_prompts"` 编译逐槽提示词。基准名次不是接口、费用或视觉质量凭证。

`charakuru_generate_views` 默认为导出预案。实际本机 `execute` 要求稳定的 `requestId`、真实启动的服务和用户明确需求。不要猜软件、模型权重可用，不要主动安装。云端只能由用户在工作台确认单槽、授权上传及费用后启动，Agent 工具不派发付费云端生成。

- Qwen：Diffusers 预案可用原画；兼容 HTTP 文生图不传原画。`qwen-image-2.1-comfy-edit` 需要 `comfyuiQwenWorkflowPath` 和一张的工程原画。模板验证通过仍不表示模型装齐。
- Anima：内置图为文生图。Aesthetic 正负提示均去 score_*；Turbo 使用独立模型、CFG 1/8 步。仅在用户明确允许的文生图任务设置 `referenceMode="text_only"`。
- NovelAI V5 实验协议不传参考；V4.5 Precise Reference 单独选卡。官方 GPT/Gemini/Ark 与自配网关路由、凭据独立；榜单目录项无运行路由。

成功产物要登记真实 PNG。重复生成已有槽位先保留新候选，不覆盖已选版本。未生成、失败、计费不确定时报告状态，不代验收、不换 ID 重发、不自动改用另一个服务。

## Tripo

`charakuru_tripo_quota(action="plan")` 仅规划。默认 200 月额度及 95/145 消耗为可改假设；以账户价格、重试、历史保留和导出权益为准，OpenAPI 独立余额。该插件不自动点击网页，也不控制其他会话的并发。

用户下载后调用 `action="archive_glb"`，填写部件、文件路径、实际消耗和远端任务 ID。归档校验 GLB 2 容器和 SHA-256；任务 ID 幂等去重，冲突时先核对记录。文件格式通过仍需伴随插件做拓扑和网格语义检查。

## Blender

先调用 `charakuru_blender_avatar(action="probe")`。使用伴随插件前读取 `blender-modeling` 技能和 `blender_rt_plan(op="catalog")`，已有网格、装配、修复、门和导出操作优先使用。

生成脚本时明确输入。执行全部要求可用 VRM Add-on，并在打开含 VRM 数据的 blend 前启用。VRM Add-on 缺失时修正环境后再试；保留原始资产和分阶段检查点。

- `stage1_safe_import`：现有 blend 或头体 GLB 导入，检查场景网格。
- `stage2_assembly_ratio`：独立网格比例和分组草稿；已有骨架时停止，避免挂点不同步。
- `stage3_rig_weights`：创建新的启发式 humanoid 与高斯权重；检测已有骨架时停止，改走显式映射流程。
- `stage4_skirt_springs`：只生成裙摆骨架草稿，SpringBone joints、碰撞体与裙摆权重需后续配置。
- `stage5_expressions_vrm`：恰好一个明确头部网格，尝试 23 形态键和 VRM 预设绑定；零位移、绑定失败或导出未 FINISHED 时失败。

阶段 2–5 返回 `degraded`，等待独立检查。回执必须包含真实结构化结果及产物；进程 `ok` 不证明资产通过。长任务提升为 job 后用 `blender_rt_job` 收集，当前插件不自动提交 job 产物到检查点。

拓扑编辑前保存回退点。用伴随 audit、asm、gate、visualreport 和动作检查形成证据；自交、漂移、腿裙间隙需真实网格或动作判据，禁止构造与几何无关的标量寻优。VRM 容器含扩展仅证明格式，外部查看器和运动质量单独验收。

## 0.2.0 资产与协议约束

- `charakuru_project(action="import_asset", assetKind="image", slotId="head_front", sourcePath=..., projectDir=...)` 登记真实 PNG；`action="scan_views"` 扫描离线 11 槽位生成结果。GLB 用 assetKind="glb" 与 part。
- 导入/归档不等于选择 GLB；请用户在资产库预览并采用头/身候选。所有图像与候选由文件 SHA-256 绑定审阅，变更后必须重新审批。
- 当前仅开放前三阶段证据审批，后续启发式工序不允许标记为完整交付。
- 执行前核对参考图适配能力，不把参考图丢弃后改成文生图。Qwen 通用兼容端点/Anima 内置图仅文生图；可明确选择 ComfyUI Qwen 编辑、离线 Diffusers 或手工导入。
- `charakuru_blender_avatar(action="probe")` 探测实际协议，不从端口猜版本；多桥接冲突须先处理。
- 3.1 GUI 执行传入已 attach/grant 的 Blender `sessionId`；DSH Host/agent/session 身份由 execution 上下文取得，禁止虚构。
- 新队列提交后返回 jobId，使用 `charakuru_blender_avatar(action="collect_job", projectDir=...)` 收集真实产物。不要重复 run_stage。未完成、失败或身份不符时保留工程状态，按伴随工具诊断，不声称任务已成功。
- 本地 HTTP session token 不是人类身份认证；Agent 不得借 HTTP 绕过“请用户审阅”的流程。


## 0.3.0 显式编辑路线

显示品牌 Avatar Studio，包/工具 ID 保持兼容；无需启动或调用原版。默认禁止云端执行；本地服务未连接时不要自行改用云端。生图 `requestId` 必须在重试时保持不变；新 ID 是新任务。手工账户账本不能代替供应商报价或防止外部消费。

现有有权使用的 Blend 优先用 `charakuru_blender_avatar(action="editor_operation", editorOperation="import_blend", editorParams={sourceBlend,vrmAddonPath}, projectDir=...)`，不要让 legacy 高斯权重工序覆盖现有 rig。后续传入明确 expectedRevisionId。

支持 audit/head_scale/transform/materials/transfer_weights/normalize_weights/configure_vrm/spring_setup/pose_check/export_vrm。参数与限制见 docs/OPERATIONS.md。AI 请求登记不等于执行；输出通过仅表示结构，视觉审阅始终 required。collect/cancel 使用 editor_collect/editor_cancel；取消请求不是终态。3.1 编辑队列尚未实机验收。

素材、Blend/VRM、截图和本机账户信息不得提交公开仓库。私测导出中的作者占位不是可发布授权声明。完整 P2～P5 未全验收，按 docs/RELEASE-0.3.0.md 如实报告缺口。
