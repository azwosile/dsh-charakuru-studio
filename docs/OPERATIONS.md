# 结构化编辑工序、双通道协同与故障指南（v0.10.0）

所有结构化编辑操作均通过 companion（`dsh-blender-plugin` 3.0.6 或 3.1 Gateway）在禁用 Blend 内置脚本自动运行的前提下打开输入文件，遵循 VRM-first 机制在 `open_mainfile` 前启用官方 VRM Add-on，并将新版本另存至 `editor/revisions/<id>/`。每个成功修订均保存 `scene.blend`、`preview.glb`、`audit.json`（`export_vrm` 时含 `avatar.vrm`，`normalize_material_mesh` 时含 `normalized.glb`）与全产物 SHA-256 指纹；用户原始外部 `.blend` 与历史修订保持 100% 只读。关闭云端执行（`allowCloudExecution=false`）不影响任何本机 Blender 编辑与渲染工序。

---

## 1. 完整 25 项结构化编辑工序（`editor_operation`）

| 工序 (`operation`) | 关键参数 (`params`) | 适用路线与边界说明 |
|---|---|---|
| `import_blend` | `sourceBlend`, 可选 `vrmAddonPath` | 从用户明确选定的本机 `.blend` 创建起始不可变修订；保留原骨架与权重 |
| `import_checkpoint` | 可选 `vrmAddonPath` | 接力本工程当前有效且已 SHA-256 指纹登记的 Blender 阶段检查点进入修订树 |
| `import_material_scene` | `materialId`, 可选 `vrmAddonPath` | 从工程已登记的 `foundation_body`（素体路线需先采用）或 `assembly_scene` 创建起始修订 |
| `normalize_material_mesh` | `materialId`, 可选 `normalize`, `autoScaleUnits`, `rotateZDeg` (`-360..360`), `targetHeight` (`0.05..10`), `groundToFloor`, `vrmAddonPath` | 导入并规范化 `.glb`/`.gltf`/`.fbx` 物料（解包父空物体并烘焙变换、FBX 大尺寸单位自适应、接地、打包贴图），导出未压缩自包含 `normalized.glb` |
| `append_material_mesh` | `materialId`, 可选 `normalize`, `autoScaleUnits`, `rotateZDeg`, `targetHeight`, `groundToFloor`, `vrmAddonPath` | 向当前修订追加已登记的 `.glb`/`.gltf`/`.fbx`（`tripo_clothing`、`tripo_hair`、`tripo_accessory`、`accessory_mesh` 或候选网格）并支持规范化变换 |
| `apply_material_texture` | `materialId`, `objects`, `textureSlot` (`0..127`), 可选 `vrmAddonPath` | 将已登记的 `texture_sheet` PNG 绑定到指定网格材质槽的 Base Color 输入并打包贴图 |
| `fit_foundation` | `bodyObject`, 可选 `armature`, `scale` `[x,y,z]` (`0.75..1.30`), `applyScale`, `shapeValues` `[{key,value,mesh?}]` (`-10..10`), `syncMeshes`, `regionScaling` | 路线 2（`base_mesh`）素体塑形：保留拓扑、UV 与权重，清理 `Studio_FoundationFit*` 空物体；支持正负向及多网格同步形态键，以及 C1 连续局部区域缩放（`preserveHead`、`legScale`、`torsoScale`、`shoulderWidthScale`、`waistScale`、`hipScale`、`armScale` 等） |
| `append_foundation_head` | `materialId`, `objects`, `headBone`, 可选 `replaceHeadObjects`, `scale`, `translation`, `rotation`, `snapNeckRim`, `neckTargetMesh`, `neckBone`, `snapTolerance` (`0.0005..0.05`), `preserveFacialBones` | 路线 2 异源头模接力：需先经 `editor_inspect` 校验 `foundation_head` 供体清单（含骨架/面部骨/颈缘估计），支持有界对位、`snapNeckRim` 颈缘吸附与 `preserveFacialBones` 保留供体面部细骨 |
| `fit_garment` | `objects`, `bodyObject`, `partCategory` (`clothing`\|`hair`\|`accessory`), 可选 `landmarkFit`, `hollowShell`, `delightAlbedo`, `fitStrategy` (`none`\|`shrinkwrap`\|`surface_deform`\|`mesh_deform_cage`), `fitOffset` (`0..0.05`), `correctiveSmooth`, `applyModifiers`, `weightSmooth`, `resolvePenetration` | 路线 2 衣/发/饰部件贴合：按地标缩放、可选去内胆与去高光、表面贴合修饰器、边界权重平滑及穿模推离，结果记录至 `audit.fitReport` |
| `audit_penetration` | `bodyObject`, `objects`, 可选 `poses`, `margin` (`0..0.03`), `fixPenetration`, `maxPush` (`0.001..0.08`), `ignoreModifiers` | 使用 `BVHTree.FromPolygons` 在 `rest` 及多姿态下审计网格间穿模（默认忽略 `Outline`/`SOLIDIFY`），可选推离 rest 穿模顶点，结果记录至 `audit.penetrationReport` |
| `rigid_attach` | `objects`, `bone`, 可选 `attachMode` (`bone_parent`\|`vertex_weight`), `armature`, `translation`, `rotation`, `scale` | 将刚性配饰绑定到显式骨骼或通过 `resolve_humanoid_bones` 解析的人形骨（支持骨父级或 100% 顶点权重） |
| `audit` | 可选 `armature`, `vrmAddonPath` | 扫描可见网格、顶点/形态键（含 `sliderMin` & `sliderMax`）、骨架变形骨、缺失贴图、零权重顶点与 VRM SpringBone 状态（骨绑定刚性网格合法豁免蒙皮零权重阻断） |
| `head_scale` | `factor` (`0.75..1.25`), 可选 `armature`, `headBone`, `pivotBone` | 对头骨及后代发骨关联顶点与形态键联动缩放；颈部接缝仍需视觉检查 |
| `transform` | `objects`, 可选 `scale` `[x,y,z]`, `translation` `[x,y,z]`, `rotation` `[rx,ry,rz]` | 对显式指定的网格对象执行有界缩放（`0.1..10`）、平移（`-10..10` 米）与欧拉角旋转（`-360..360` 度），不执行任意 Python |
| `materials` | `materialMode` (`preserve` / `pbr` / `mtoon`)，可选 MToon 参数（`shadeColor`, `shadingShift`, `shadingToony`, `matcapMaterialId`, `matcapFactor`, `rimColor`, `rimFresnelPower`, `rimLift`, `outlineWidthMode`, `outlineWidthFactor`, `outlineColor`） | `preserve` 校验并保留既有贴图；`pbr` 按现有图像启发式关联色图并打包；`mtoon` 委派 `apply_mtoon` 配置 VRM 1.0 MToon 或 ShaderNode 回退 |
| `smart_mesh_retexture` | 可选 `groups` (`hair`\|`head`\|`upper_body`\|`lower_body`\|`accessories`), `textureSize` (`1024`\|`2048`\|`4096`), `smartUvAngleDeg` (`15..89`), `uvMargin` (`0.001..0.1`), `delight`, `viewImageMaterialIds` (`front`/`right`/`left`/`back`), `separatePhysicsGroup` | Clean-Room 连通孤岛与语义高度分组（`lower_body` 统一裙/腿/鞋防撕裂），Smart UV 展开并烘焙/投影打包 4K/2K/1K 贴图，写入 `audit.smartMeshReport` |
| `apply_mtoon` | 可选 `objects`, `shadeColor`, `shadingShift` (`-1..1`), `shadingToony` (`0..1`), `matcapMaterialId`, `matcapFactor`, `rimColor`, `rimFresnelPower` (`0..10`), `rimLift` (`0..1`), `outlineWidthMode` (`none`\|`worldCoordinates`\|`screenCoordinates`), `outlineWidthFactor` (`0..0.05`), `outlineColor` | 启用官方 VRM 插件配置完整 `VRMC_materials_mtoon`（无插件时降级为 ShaderNode 卡通材质），保留基色贴图与透明通道，写入 `audit.mtoonReport` |
| `expression_lab` | `presets`（`happy`/`angry`/`sad`/`relaxed`/`surprised`/`blink`/`blinkLeft`/`blinkRight`/`aa`/`ih`/`ou`/`ee`/`oh`/`neutral` 非空子集），可选 `headMesh`, `excludeHairByBbox`, `hairVertexGroups`, `intensity` (`0.1..2.0`), `bindVrm1`, `overwriteExisting` | Clean-Room 表情实验室：排除头发顶点以隔离面部包围盒，生成非破坏性相对形态键并可选绑定 `vrm1.expressions.preset`，写入 `audit.expressionLabReport`；`expressions: 'expression_lab'` 已放行 |
| `physics_oscillation_audit` | 可选 `bodyObject`, `objects`, `frames` (`8..120`), `amplitudeDeg` (`5..90`), `ignoreModifiers`, `compareSpringOff` | 在解析的人形骨上对比 SpringBone 开启与关闭时的受控摆动位移及 `BVHTree.overlap()` 穿模变化（0-骨匹配立即阻断），写入 `audit.physicsOscillationReport` |
| `transfer_weights` | `sourceMesh`, `objects`, `maxTransferDistance` (`0..1`) | 从同工程显式 `sourceMesh` 的求值变形表面（`evaluated_get`）通过 `BVHTree` 最近三角重心插值转移变形骨权重并自动绑定骨架父级 |
| `normalize_weights` | 可选 `objects`, `armature` | 归一化已有变形骨权重；存在未加权顶点时明确报错指出 `Object:vertexIndex` |
| `configure_vrm` | `humanBones`, `title`, `authors`, 可选 `commercialUsage` | 写入 VRM 1.0 Humanoid 骨骼映射与作者/许可元数据；默认禁止再分发 |
| `spring_setup` | `chains`, `colliderBones`, `stiffness`, `dragForce`, `gravityPower`, `hitRadius`, 可选 `mode` (`append`\|`replace`\|`strict`), `frontStiffnessMultiplier`, `windDrag`, `colliderGroupName`, `springNamePrefix`, `skirt` (`mesh`, `waistZ`, `hemZ`, `segments`, `rings`, `rootBone`, `includeVertexGroup`, `excludeVertexGroups`, `minRadius`, `maxRadius`, `frontStiffnessMultiplier`, `prefix`, `mode`) | 配置 VRM 1.0 SpringBone 链条、世界空间胶囊碰撞体与可选连续双线性插值裙摆骨架。默认 `mode: 'append'` 保留既有发饰/胸春骨；裙摆清理旧权重须使用 `group.remove`（严禁写 0.0 权重） |
| `pose_check` | 可选 `armature`, `bodyObject`, `boneMap`, `poses`, `highKickDeg` (`60..130`), `angle`, `captureScreenshots` | 通过 `resolve_humanoid_bones`（`boneMap` > VRM 1.0/0.x > 多语义别名表）解析人形骨，**0-骨匹配立即报错阻断**；运行 `rest`/`head_turn`/`arm_raise`/`elbow_bend`/`high_kick` 等多姿态与穿模校验，可选输出 `pose_<name>.png` 并保证异常时复位姿态 |
| `export_vrm` | 可选 `armature`, `vrmAddonPath` | 校验 `gates.weights` 与 `gates.textures` 通过后导出 VRM 1.0 `avatar.vrm`，校验 GLB 2 + `VRMC_vrm` 容器并自动同步 `state.vrmMetadata.exportedVrmPath` |

### 参数示例（请替换为当前修订通过 `editor_inspect` 查得的真实对象名）

```json
{
  "operation": "fit_foundation",
  "params": {
    "bodyObject": "Body",
    "shapeValues": [{ "key": "Chest", "value": -0.25 }],
    "regionScaling": {
      "preserveHead": true,
      "legScale": 1.04,
      "shoulderWidthScale": 0.96
    }
  }
}
```

```json
{
  "operation": "spring_setup",
  "params": {
    "mode": "append",
    "skirt": {
      "mesh": "Skirt",
      "waistZ": 0.92,
      "hemZ": 0.55,
      "segments": 8,
      "rings": 4,
      "rootBone": "hips",
      "frontStiffnessMultiplier": 1.4,
      "mode": "replace"
    }
  }
}
```

---

## 2. 独立 AI 渲染台配方（`v0.8.0` `charakuru_render`）

`validateRenderRecipe` 与 `lib/blender/render-studio.py` 在保持向后兼容（未传新字段时不向旧配方注入额外默认键）的基础上，支持以下 NPR 与 Blender 4.2 LTS–5.x 渲染选项：

- **渲染引擎与分辨率**：`engine`（`'eevee'` | `'cycles'`，自动检测 `BLENDER_EEVEE_NEXT` / `BLENDER_EEVEE` / `CYCLES`）；`size` 新增 `hd1080` (`1920x1080`)、`portrait1080` (`1080x1920`)、`uhd4k` (`3840x2160`)、`portrait4k` (`2160x3840`)，PNG 上限提升至 64 MiB。
- **镜头与取景控制**：`lensType`（`'ortho'` | `'persp'`）、`lens`（`18..200`）、`dof`（`{ enabled, fstop: 0.7..22, focusDistance: 0.1..50 }`）、`yawDeg`（`-180..180`）、`pitchDeg`（`-60..60`）、`transparent`（透明 RGBA 背景、隐藏地面）、`samples`（`4..256`）、`frame`（`0..100000`）。
- **色彩管理与 NPR 着色**：`viewTransform`（`'Standard'` | `'AgX'` | `'Filmic'`）、`look`（`'None'` | `'Medium High Contrast'` | `'High Contrast'` | `'Medium Contrast'`；当 `toon: true` 时默认 `Standard` + `Medium High Contrast`）。`toonOptions` 支持 `{ outline, outlineThickness: 0.0005..0.005, outlineColor: [r,g,b], faceSdf, faceSdfMaterialId, specularRim, metallicStep }`，其中 `faceSdfMaterialId` 须指向工程内已登记的 `.png` 贴图；Blender 节点统一使用 `ShaderNodeMix`（兼容 4.2–5.x）与按 `node.type == 'BSDF_PRINCIPLED'` 查找节点并保留 MToon 与眼/角膜半透明材质，反法线 `Solidify` 描边使用 `ShaderNodeNewGeometry` (`Backfacing`) + `ShaderNodeMixShader`（同时兼容 EEVEE Next / EEVEE 5.0 / Cycles）与最末材质槽追加及 `AS_OutlineMask` 屏蔽眼部与口腔。
- **辅助通道**：`passes` 可选 `['albedo', 'normal', 'depth']`（最多 3 项），渲染摘要在工作台渲染栏显示 `engine`、`viewTransform`、`lensType`、`toonMaterials`、`outlineMeshes` 与 `faceSdfMaterials`。

---

## 3. Blender 双通道混合架构（Plugin 契约层 × Agent Computer-Use GUI）

`v0.8.0` 支持在同一工程的 `editor.revisions[]` 不可变修订树上混合接力两条 Blender 通道，可在工作台或通过 `charakuru_blender_avatar(action="set_channel_preference", channelPreference="auto" | "plugin" | "computer_use")` 切换偏好：

1. **通道 1：`dsh-blender-plugin` 契约层与结构化管线（`plugin`）**：
   - 适合批量参数化操作（`fit_foundation`、`normalize_material_mesh`、`fit_garment`、`audit_penetration`、`rigid_attach`、`transform`、`transfer_weights`、`configure_vrm`、`spring_setup`、`pose_check`、`export_vrm`）与离线 Eevee/Cycles 渲染（`charakuru_render`）。
   - 支持 `executionTarget: "headless"`（默认，不抢占桌面焦点）与 `"gui_act"`（当 `doctor.kind === "ok"` 时通过伴随插件 GUI `/act` 执行）。
   - 支持 `charakuru_blender_avatar(action="probe", sceneQuery="...")` 调用 `/host/scene-items` 查询实时场景对象，并配合伴随插件契约层、`blender_rt_txn` / `blender_session(action="txn")` 事务快照及 `blender_rt_see` / `blender_see` 多视角截图。
2. **通道 2：Agent Computer-Use GUI 签出 / 签入协议（`computer_use`）**：
   - 适合自由手工微调（Sculpt 笔刷消穿模、Weight Paint 逐顶点刷权重、复杂材质节点调试、第三方 Blender 扩展操作）。
   - **`checkout_gui`**（`POST /studio/editor/gui-checkout`）：验证 `expectedRevisionId` 与基线 `.blend` SHA-256，创建工程级 `guiCheckout` 锁并将基线拷贝至隔离工作副本 `editor/working/<checkoutId>/scene.blend`。签出期间锁定其他并发 `editor_operation`，保护 `editor/revisions/` 与用户外部源文件绝对只读。
   - **`checkin_gui`**（`POST /studio/editor/gui-checkin`）：在 Blender GUI 保存 `editor/working/<checkoutId>/scene.blend` 后调用；companion 自动打包全部贴图（`pack_all`）、导出 `preview.glb`（及 `exportVrm=true` 时的 `avatar.vrm`）、执行 `audit()` 并计算全套 SHA-256，生成新的不可变修订 `editor/revisions/<newId>/` 并释放 `guiCheckout` 锁。新修订立即可在工作台 3D 视口审阅或通过 `editor_rollback` 回滚。
   - **`abort_gui`**（`POST /studio/editor/gui-abort`）：放弃并清理未签入的工作副本，释放 `guiCheckout` 锁，不影响任何既有修订。

---

## 4. Tripo 双通道与同机 Web 全功能支持

1. **Tripo OpenAPI v3 通道（`POST /studio/tripo/openapi` / `charakuru_tripo_quota`）**：
   - `openapi_balance`：实时查询独立 OpenAPI 余额（与网页 Studio 免费额度严格分账）。
   - `openapi_submit` / `openapi_poll`：受 `allowCloudExecution`、用户报价确认、`expectedRevision` 与 `account-budget.js` 账本预留（`reserve` → `submit` → `settle` / `uncertain` / `cancel`）保护。内置参数陷阱拦截（后处理任务禁止设置 `export_orientation`；`generate_parts=true` 与 `texture`/`pbr`/`quad`/`smart_low_poly` 互斥；`multiview_to_model` 强制要求 `front` 及至少 2 张视图）。任务成功后立即流式下载归档，规避 5 分钟签名 URL 过期。
2. **Tripo 浏览器多视角工单（`studio-handoff.js`）**：
   - 路线 1 绑定 4 张已审视图；路线 2 `base_mesh` 支持绑定 **1–4 张**同部件多视角参考 PNG（`referenceMaterialIds`）。
   - `confirm_quote` 直接返回 `inbox` 回收目录；同时支持 DSH Desktop 原生路径选取与同机 DSH Web 二进制流式上传（`POST /studio/tripo/studio/upload`）。
3. **同机 Web 目录浏览与新建（`POST /studio/fs/browse` & `POST /studio/fs/mkdir`）**：
   - 在无 Electron 原生目录选择器的同机浏览器（`http://127.0.0.1:*`、`http://localhost:*`、`http://[::1]:*`）中，支持直接在全局设置抽屉浏览本机工程目录并新建子目录。

---

## 5. AI 协作请求、全 6 关审阅与常见故障排查

- **只读审查与草稿绑定**：`editor_inspect` 支持传入 `editRequestId` 审查待办请求，也支持省略 `editRequestId` 直接只读审查当前活动修订。AI 编辑完成后生成 `ready_for_review` 修订，必须由用户在工作台对比预览后点击批准或退回。
- **全 6 关审阅打通**：Stages 1–3 绑定原画、11 视图与 Tripo 候选 SHA-256；Stages 4–6 绑定活动编辑修订的装配审计、权重/SpringBone/多姿态探针证据与 `exportedVrmPath` VRM 1.0 产物，全 6 关均可通过 `request_review` 提交并由人工批准。
- **常见错误与处理**：
  - `cannot get property "webServer" without inject`（已修复）：`0.8.0` 在保持数组形式 `inject` 的前提下，通过 `resolveCordisService` 优先调用 `ctx.get(...)` 并容错回退，不再因未声明可选服务而崩溃。
  - `Anima dimensions must be multiples of 16`：Anima 宽/高在参数校验与工作流生成层均强制为 16 的倍数。
  - `pose_check` 报 0 个骨骼匹配：请通过 `params.boneMap` 显式映射骨骼名，或确认目标骨架包含 VRM / Rigify / Tripo / Mixamo / MMD / Unity 人形骨。
  - `An editor GUI working copy is already checked out`：当前存在未完结的 `checkout_gui` 工作副本；请先完成 `checkin_gui` 固化修订或调用 `abort_gui` 释放锁。
  - `Unweighted vertex: Object:index`：目标网格存在无变形骨权重的蒙皮顶点；请对服装执行 `transfer_weights` 或切换至 `checkout_gui` 在 Blender Weight Paint 中手工补权（刚性配件建议使用 `rigid_attach` 或 `parent_type='BONE'` 绑定）。
  - `Editor job is pending`：先执行 `editor_collect` 收集终态；若伴随作业已变为 `killed`/`stale`/`unknown` 或校验失败，收集器会自动记录 `lastFailedJob` 并释放 `pendingJob` 锁。

---

## 6. 无 Agent VRM 1.0 元数据修补与内置 MIT/CC0 VRMA（v0.9.0）

- **无 Agent 一键写入元数据并导出（`POST /studio/vrm/export-meta` / `lib/vrm/metadata-patcher.js`）**：纯 Node ESM 实现（零外部依赖），校验 GLB 2.0 头部与 `VRMC_vrm` `specVersion === '1.0'`，原地更新 `extensions.VRMC_vrm.meta`（`title`→`name`、`version`、`authors`、`commercialUsage`、`allowRedistribution`、`modification` 等），以 `0x20` 对齐 JSON 块至 4 字节并**逐字节保留 BIN 网格块**，同步写入 `exports/avatar_meta_<short>.vrm` 与 `state.vrmMetadata` 并直接返回浏览器下载字节。
- **内置 MIT/CC0 漫步 VRMA（`GET /studio/motions/builtin`）**：由 `scripts/generate-builtin-vrma.mjs` 程序化生成 `assets/motions/cleanroom_walk_loop.vrma`（GLB 2.0 + `VRMC_vrm_animation` 1.0，15 根人形骨 1.0s 无缝循环步行动画），可在工作台与编辑器视口直接选择 `builtin:walk` 预览，无需额外导入外部动作文件。

---

## 7. `v0.10.0` 兼容性与安全加固清单

- **Blender 4.2 LTS / 5.x & VRM Add-on**：
  - `studio-pipeline.py`：修复 `None in arm.data.bones` `TypeError`；`_smart_uv_project_object` 清除/恢复 `hide_viewport` 并通过 `bpy.context.temp_override` 保护 `VIEW_3D`/`WINDOW` 上下文；`fit_garment` 在 `surface_deform` 复制素体笼体后清除 `shape_keys` 并保护单用户网格、`cage` 可见性与 `surfacedeform_bind` 选中态；新增 `_armature_edit_mode` 异常安全上下文、`_set_enum_safely` 大小写无关 VRM 枚举赋值与按 `node.type == 'BSDF_PRINCIPLED'` 查找节点。
  - `render-studio.py`：`apply_outline_shells` 使用 `ShaderNodeNewGeometry.Backfacing` + `ShaderNodeMixShader` + `ShaderNodeBsdfTransparent` 兼顾 Cycles 与 EEVEE 反壳描边，确保 `outline_mat` 追加至最末材质槽，跳过已启用 MToon 内置描边的网格，并补齐 VRM 0.x 头部骨骼回退、Face SDF `RGBToBW` 连接与 `px_height > 0` 守卫。
  - `cleanroom-scripts.js`：统一 `open_mainfile(..., load_ui=False, use_scripts=False)`、安全 `ensure_parent_dir`、0 骨骨架保护与 `kb.relative_key`。
- **Host / Client / 桥接与生图驱动**：
  - Host 回环：畸形/缺失 `Host` 统一返回 `403 HOST_DENIED`；全部 5 个二进制 GET 端点补齐 `Referrer-Policy: no-referrer`；JSON 超限返回 `413`；允许 `application/octet-stream; charset=...`；`/studio/fs/mkdir` 拒绝尾部点号/空格与 Windows 保留设备名。
  - 前端与 3D 视口：客户端 `safeGetService` 兼容严格 Cordis 4 `Proxy`；修复 `rebuildTriViews` 过期 `targetHeightM` 闭包与异步 `fetch` 竞态（`triViewSeq`）；修复 `DeskVrmMetadataExport` 活动修订无 `.vrm` 时的 `revisionId` 回退及 `guiCheckout` 期间按钮禁用守卫。
  - 桥接与驱动：`inspectAiEdit` 在 GUI 签出期间允许写回 `donorInspection`；`collectCompanionJob` 采用键序无关 `caller` 字段比对；Tripo OpenAPI v3 阻断终态失败/取消 `requestId` 复用并为轮询/下载绑定 `AbortController` 超时；ComfyUI Qwen 采样器节点不再混入 `resolution` 字段。
