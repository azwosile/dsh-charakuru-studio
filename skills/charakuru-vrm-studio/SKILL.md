---
name: charakuru-vrm-studio
description: 使用独立角色工作台管理 2D 到 VRM 工程、编译 11 视图提示词、导出生图工作流、规划 Tripo 预算并通过伴随插件运行 Blender 草稿脚本。适用于角色拆件、多视图、GLB 归档和 VRM 制作辅助；骨架、裙摆和表情效果需人工验收。
---

# 角色工程操作规程

先读取 `charakuru_project(action="status", projectDir=...)`。工程尚未创建时使用 `action="init"`，填写角色描述和账户实际月额度。所有工具明确传入 `projectDir`；默认目录固定，不随其他会话切换。

## 六个关卡

1. `1_concept`：明确外观、预算、模型、参考图与交付要求。
2. `2_views`：头部四视图、身体四视图、全身比例三视图。头部闭口且无遮挡，身体水平 T-pose；对齐眼线、肩线、胯线和鞋底。
3. `3_tripo`：生成手动 Studio 操作计划，用户网页提交、下载 GLB 并归档。
4. `4_assembly`：导入、比例草稿、对象分组、多角度检查。
5. `5_rig_spring`：启发式骨架权重与裙摆骨架草案；人工配置弹簧、碰撞体和服装权重。
6. `6_expressions_vrm`：表情草稿、元数据与导出尝试；检查位移、预设绑定、动作及查看器表现。

完成当前阶段后用 `charakuru_project(action="checkpoint", checkpointAction="request_review", ...)` 提交证据。Agent 工具支持提交审阅和恢复编辑；用户在会话顶栏「Charakuru 工作台」批准或要求修改。逐关推进，禁止将脚本执行成功替代人工验收。

## 生图

`charakuru_aa_models(action="leaderboard")` 查询静态 AA 快照，`action="compile_prompts"` 编译模型提示词。快照时间为 2026-11-16，模型显示名与候选 API ID 不等价。

`charakuru_generate_views` 默认导出工作流。实际请求使用 `mode="execute"`，云端还需供应商实际 `apiModelOverride`。核对用户的请求和预算；已有明确执行指令时继续执行。密钥通过工作台密码框或环境变量设置，`charakuru_credentials` 只显示状态。

- Qwen：导出的 Diffusers 脚本支持参考 PNG；本地兼容生图端点为文生图。
- Anima：基础图使用 CLIPLoader `stable_diffusion` 和 EmptyLatentImage；turbo 使用基础模型加 turbo LoRA、CFG 1、8 步。aesthetic 指定 UNet，移除 score 标签；画师使用 `@`。内置图为文生图。
- NovelAI：API ID 明确指定；内置 Precise Reference 请求仅限 V4.5。
- Gemini：支持内联参考 PNG。
- OpenAI 兼容网关：协议、模型 ID 与返回格式需匹配供应商。

生图逐张验证 PNG 后更新状态。全部失败为 `fail`，部分失败为 `degraded`；补齐缺失视图后再审阅。导出工作流不代表图像已生成。参考 PNG 仅发送到支持该输入的所选服务。

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
