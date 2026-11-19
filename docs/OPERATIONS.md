# 结构化编辑工序、双通道协同与故障指南（v0.7.0）

所有结构化编辑操作均通过 companion（`dsh-blender-plugin` 3.0.6 或 3.1 Gateway）在禁用 Blend 内置脚本自动运行的前提下打开输入文件，遵循 VRM-first 机制在 `open_mainfile` 前启用官方 VRM Add-on，并将新版本另存至 `editor/revisions/<id>/`。每个成功修订均保存 `scene.blend`、`preview.glb`、`audit.json`（及 `export_vrm` 时的 `avatar.vrm`）与全产物 SHA-256 指纹；用户原始外部 `.blend` 与历史修订保持 100% 只读。关闭云端执行（`allowCloudExecution=false`）不影响任何本机 Blender 编辑与渲染工序。

---

## 1. 完整 17 项结构化编辑工序（`editor_operation`）

| 工序 (`operation`) | 关键参数 (`params`) | 适用路线与边界说明 |
|---|---|---|
| `import_blend` | `sourceBlend`, 可选 `vrmAddonPath` | 从用户明确选定的本机 `.blend` 创建起始不可变修订；保留原骨架与权重 |
| `import_checkpoint` | 可选 `vrmAddonPath` | 接力本工程当前有效且已 SHA-256 指纹登记的 Blender 阶段检查点进入修订树 |
| `import_material_scene` | `materialId`, 可选 `vrmAddonPath` | 从工程已登记的 `foundation_body`（素体路线需先采用）或 `assembly_scene` 创建起始修订 |
| `append_material_mesh` | `materialId`, 可选 `vrmAddonPath` | 向当前修订追加已登记的 `tripo_clothing`、`tripo_hair`、`tripo_accessory` 或 `accessory_mesh`（素体路线需源自已采用素体） |
| `apply_material_texture` | `materialId`, `objects`, 可选 `vrmAddonPath` | 将已登记的 `texture_sheet` PNG 绑定到指定网格材质的 Base Color 输入并打包贴图 |
| `fit_foundation` | `bodyObject`, 可选 `armature`, `scale` `[x,y,z]`, `shapeValues` `[{key,value}]` | 路线 2（`base_mesh`）素体塑形：保留原拓扑、UV 与变形骨权重，执行有界缩放（`0.75..1.35`）与形态键调整（`0..1`） |
| `append_foundation_head` | `materialId`, `objects`, `headBone`, 可选 `replaceHeadObjects`, `scale`, `translation`, `rotation` | 路线 2 异源头模接力：需先经 `editor_inspect` 校验已采用 `foundation_head` 供体清单，围绕供体中心执行有界缩放、平移与欧拉角旋转（`[-360..360]`）并绑定到目标 `headBone` |
| `audit` | 可选 `armature`, `vrmAddonPath` | 扫描可见网格、顶点/形态键、骨架变形骨、缺失贴图、零权重顶点与 VRM SpringBone 状态（骨绑定刚性网格合法豁免蒙皮零权重阻断） |
| `head_scale` | `factor` (`0.75..1.25`), 可选 `armature`, `headBone`, `pivotBone` | 对头骨及后代发骨关联顶点与形态键联动缩放；颈部接缝仍需视觉检查 |
| `transform` | `objects`, 可选 `scale` `[x,y,z]`, `translation` `[x,y,z]`, `rotation` `[rx,ry,rz]` | 对显式指定的网格对象执行有界缩放（`0.05..20`）、平移（`-10..10` 米）与欧拉角旋转（`-360..360` 度），不执行任意 Python |
| `materials` | `materialMode` (`preserve` / `pbr`) | `preserve` 校验并保留既有贴图；`pbr` 按现有图像启发式关联色图并打包，不凭空重建纹理 |
| `transfer_weights` | `sourceMesh`, `objects`, `maxTransferDistance` (`0.005..2.0`) | 从同工程显式 `sourceMesh` 的求值变形表面（`evaluated_get`）通过 `BVHTree` 最近三角重心插值转移变形骨权重并自动绑定骨架父级 |
| `normalize_weights` | 可选 `objects`, `armature` | 归一化已有变形骨权重；存在未加权顶点时明确报错指出 `Object:vertexIndex` |
| `configure_vrm` | `humanBones`, `title`, `authors`, 可选权限字段 | 写入 VRM 1.0 Humanoid 骨骼映射与作者/许可元数据；默认禁止再分发 |
| `spring_setup` | `chains`, `colliderBones`, `stiffness`, `drag`, `gravity`, `hitRadius`, 可选 `skirt` | 配置 VRM 1.0 SpringBone 链条、碰撞体胶囊与可选裙摆辅助骨链；已有弹簧配置需先回滚再重配 |
| `pose_check` | 可选 `armature`, `angle` (`5..45`) | 对大腿与上臂骨执行有限值姿态探针并复位；用于辅助暴露绑定异常，不替代完整动作验收 |
| `export_vrm` | 可选 `armature`, `vrmAddonPath` | 校验 `gates.weights` 与 `gates.textures` 通过后导出 VRM 1.0 `avatar.vrm`，校验 GLB 2 + `VRMC_vrm` 容器并自动同步 `state.vrmMetadata.exportedVrmPath` |

### 参数示例（请替换为当前修订通过 `editor_inspect` 查得的真实对象名）

```json
{
  "operation": "transform",
  "params": {
    "objects": ["Tripo_Hair"],
    "scale": [1.0, 1.0, 1.0],
    "translation": [0.0, -0.02, 1.48],
    "rotation": [0.0, 0.0, -90.0]
  }
}
```

```json
{
  "operation": "transfer_weights",
  "params": {
    "sourceMesh": "Yumeka_Body",
    "objects": ["Tripo_Coat"],
    "maxTransferDistance": 0.25
  }
}
```

---

## 2. Blender 双通道混合架构（Plugin 契约层 × Agent Computer-Use GUI）

`v0.7.0` 支持在同一工程的 `editor.revisions[]` 不可变修订树上混合接力两条 Blender 通道，可在工作台或通过 `charakuru_blender_avatar(action="set_channel_preference", channelPreference="auto" | "plugin" | "computer_use")` 切换偏好：

1. **通道 1：`dsh-blender-plugin` 契约层与结构化管线（`plugin`）**：
   - 适合批量参数化操作（`fit_foundation`、`transform`、`transfer_weights`、`configure_vrm`、`export_vrm`）与离线 Eevee 渲染（`charakuru_render`）。
   - 支持 `executionTarget: "headless"`（默认，不抢占桌面焦点）与 `"gui_act"`（当 `doctor.kind === "ok"` 时通过伴随插件 GUI `/act` 执行）。
   - 支持 `charakuru_blender_avatar(action="probe", sceneQuery="...")` 调用 `/host/scene-items` 查询实时场景对象，并配合伴随插件 228-op 契约层、`blender_rt_txn` / `blender_session(action="txn")` 事务快照及 `blender_rt_see` / `blender_see` 多视角截图。
2. **通道 2：Agent Computer-Use GUI 签出 / 签入协议（`computer_use`）**：
   - 适合自由手工微调（Sculpt 笔刷消穿模、Weight Paint 逐顶点刷权重、复杂材质节点调试、第三方 Blender 扩展操作）。
   - **`checkout_gui`**（`POST /studio/editor/gui-checkout`）：验证 `expectedRevisionId` 与基线 `.blend` SHA-256，创建工程级 `guiCheckout` 锁并将基线拷贝至隔离工作副本 `editor/working/<checkoutId>/scene.blend`。签出期间锁定其他并发 `editor_operation`，保护 `editor/revisions/` 与用户外部源文件绝对只读。
   - **`checkin_gui`**（`POST /studio/editor/gui-checkin`）：在 Blender GUI 保存 `editor/working/<checkoutId>/scene.blend` 后调用；companion 自动打包全部贴图（`pack_all`）、导出 `preview.glb`（及 `exportVrm=true` 时的 `avatar.vrm`）、执行 `audit()` 并计算全套 SHA-256，生成新的不可变修订 `editor/revisions/<newId>/` 并释放 `guiCheckout` 锁。新修订立即可在工作台 3D 视口审阅或通过 `editor_rollback` 回滚。
   - **`abort_gui`**（`POST /studio/editor/gui-abort`）：放弃并清理未签入的工作副本，释放 `guiCheckout` 锁，不影响任何既有修订。

---

## 3. Tripo 双通道与同机 Web 全功能支持

1. **Tripo OpenAPI v3 通道（`POST /studio/tripo/openapi` / `charakuru_tripo_quota`）**：
   - `openapi_balance`：实时查询独立 OpenAPI 余额（与网页 Studio 免费额度严格分账）。
   - `openapi_submit` / `openapi_poll`：受 `allowCloudExecution`、用户报价确认、`expectedRevision` 与 `account-budget.js` 账本预留（`reserve` → `submit` → `settle` / `uncertain` / `cancel`）保护。内置参数陷阱拦截（后处理任务禁止设置 `export_orientation`；`generate_parts=true` 与 `texture`/`pbr`/`quad`/`smart_low_poly` 互斥；`multiview_to_model` 强制要求 `front` 及至少 2 张视图）。任务成功后立即流式下载归档，规避 5 分钟签名 URL 过期。
2. **Tripo 浏览器多视角工单（`studio-handoff.js`）**：
   - 路线 1 绑定 4 张已审视图；路线 2 `base_mesh` 支持绑定 **1–4 张**同部件多视角参考 PNG（`referenceMaterialIds`）。
   - `confirm_quote` 直接返回 `inbox` 回收目录；同时支持 DSH Desktop 原生路径选取与同机 DSH Web 二进制流式上传（`POST /studio/tripo/studio/upload`）。
3. **同机 Web 目录浏览与新建（`POST /studio/fs/browse` & `POST /studio/fs/mkdir`）**：
   - 在无 Electron 原生目录选择器的同机浏览器（`http://127.0.0.1:*`、`http://localhost:*`、`http://[::1]:*`）中，支持直接在全局设置抽屉浏览本机工程目录并新建子目录。

---

## 4. AI 协作请求、全 6 关审阅与常见故障排查

- **只读审查与草稿绑定**：`editor_inspect` 支持传入 `editRequestId` 审查待办请求，也支持省略 `editRequestId` 直接只读审查当前活动修订。AI 编辑完成后生成 `ready_for_review` 修订，必须由用户在工作台对比预览后点击批准或退回。
- **全 6 关审阅打通**：Stages 1–3 绑定原画、11 视图与 Tripo 候选 SHA-256；Stages 4–6 绑定活动编辑修订的装配审计、权重/SpringBone 证据与 `exportedVrmPath` VRM 1.0 产物，全 6 关均可通过 `request_review` 提交并由人工批准。
- **常见错误与处理**：
  - `An editor GUI working copy is already checked out`：当前存在未完结的 `checkout_gui` 工作副本；请先完成 `checkin_gui` 固化修订或调用 `abort_gui` 释放锁。
  - `Do not set export_orientation when post-processing is planned` / `generate_parts=true is mutually exclusive...`：触发 Tripo OpenAPI v3 参数防呆保护，请移除冲突参数后再提交。
  - `Unweighted vertex: Object:index`：目标网格存在无变形骨权重的蒙皮顶点；请对服装执行 `transfer_weights` 或切换至 `checkout_gui` 在 Blender Weight Paint 中手工补权（刚性配件建议使用 `parent_type='BONE'` 绑定）。
  - `Editor job is pending`：先执行 `editor_collect` 收集终态；若伴随作业已变为 `killed`/`stale`/`unknown` 或校验失败，收集器会自动记录 `lastFailedJob` 并释放 `pendingJob` 锁。
