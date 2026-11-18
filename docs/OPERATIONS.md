# 结构化编辑工序与故障指南

所有操作通过 companion 打开输入文件，禁用 Blend 内脚本自动运行，另存 `editor/revisions/<id>/`。每个成功版本保存 Blend、GLB、审计和 SHA-256。源模型仍保持原路径原内容。关闭云端不影响这些工序。

建议先复制工程进行验证。程序会改变所选分支的网格/骨骼/材质；没有任何“自动获得成品”的承诺。

## 操作

| operation | 关键参数 | 限制 |
|---|---|---|
| import_blend | sourceBlend, vrmAddonPath | 新工程也可导入；来源必须由用户明确选择 |
| audit | 可选 armature | 结构和纹理检查，不是质量审批 |
| head_scale | factor 0.75～1.25, armature, headBone, pivotBone | 对头骨与后代发骨的权重顶点/shape keys 联动，颈部过渡仍需检查 |
| transform | objects, scale, translation | 只操作明确 mesh，不执行任意 Python |
| materials | materialMode=preserve/pbr | preserve 检查已有图；pbr 为实验分支，按现有图像启发选择色图，需人工确认，不重建纹理 |
| transfer_weights | sourceMesh, objects, maxTransferDistance | 显式同工程源网格；最近表面三角插值；不得用未经授权 donor |
| normalize_weights | objects（可选） | 归一化已有 deform bone 权重；有未加权顶点即失败，不能凭空生成解剖权重 |
| configure_vrm | humanBones, title, authors | 明确映射与归属；默认禁止再分发；私测占位作者不能用于发布 |
| spring_setup | chains, colliderBones, 可选 skirt | 真实 SpringBone joints 和胶囊；已有配置拒绝叠加，先回滚 |
| pose_check | armature | 当前为指定骨名有限值探针，不是穿模、步态或物理质量检测 |
| export_vrm | armature | 权重/纹理门禁与 exporter 校验；输出存在不等于外部兼容通过 |

示例（替换为自己工程真实对象名）：

```json
{"sourceMesh":"Body","objects":["Outfit"],"maxTransferDistance":0.25}
```

权重转移会覆盖目标的变形骨权重，但不改来源网格；距离超限指出对象、顶点。服装/裙摆结构必须逐件检查，不能认为所有角色都适用。

`spring_setup` 的 `skirt` 参数包含 `mesh, rootBone, waistZ, hemZ, segments, rings`，坐标为骨架局部米、Z 轴向上。裙区域按 Z 范围筛选，混合服装可能误选非裙部位。该工序只在新版本移除所选 mesh 上的 CLOTH/SURFACE_DEFORM；穿模修正仍需人工。复杂服装、非 Z-up 骨架应先在 Blender 明确分件/对齐，不应直接套用示例。

## AI 请求与审批

选中对象、视角并登记要求，服务保存 baseRevisionId、Blend hash、对象与相机。返回给 Agent 的指令使用 `charakuru_blender_avatar` 的 `editor_operation` 与 `expectedRevisionId`。请求登记本身不调用模型，不执行自由文本 Python。执行后仍需审阅。P2/P3 尚未开放“成品自动审批”。

## 常见错误

- `Unweighted vertex: Object:index`：目标缺有效 deform weights；不是重复点归一化按钮就能修复。选择有权使用、结构对应的源网格，或在 Blender 手工权重。
- `Required humanoid assignments missing`：补齐映射，不能靠重命名文件绕过。
- `No add-on preferences`：使用支持当前 Blender 的官方 add-on；本插件项目级 enable 设置内存 preferences，不保存全局配置。
- `Blender process failed`：查看该版本目录 `companion-receipt.json` 和 stdout/stderr；失败输出不会激活。
- `Editor job is pending`：通过 collect 收集；取消仅是请求，必须收集终态才可新提交。3.1 队列实机未验收。
- `Base revision changed`：刷新工程，明确新的编辑基线；不以旧 AI 请求覆盖新版本。
- WebGL 不可用：更新图形环境；不能退回用“文件存在”代替预览。

## 必做视觉清单

正/侧/背观察轮廓、纹理方向、颈部接缝、头发随动；检查裙摆权重、抬腿穿模、碰撞半径、头发尾巴弹簧；在独立 VRM 查看器中验证；不同服装结构分别验收。运行时的正弦动作探针只帮助暴露问题，不产生通过证书。
