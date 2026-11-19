const MiB = 1024 * 1024;
const png = ['.png'];
const blend = ['.blend'];
const glb = ['.glb'];
const mesh = ['.glb', '.fbx'];
const role = (stageId, id, titleZh, titleEn, extensions, intent, maxMiB, useZh, useEn) => Object.freeze({
  stageId, id, titleZh, titleEn, extensions: Object.freeze(extensions), intent, maxBytes: maxMiB * MiB, useZh, useEn,
});

// Each use is specific to one step. Importing is independent of checkpoint state.
export const MATERIAL_ROLES = Object.freeze([
  role('1_concept', 'original', '角色原画', 'Original illustration', png, 'original', 20,
    '采用后成为生图参考，并要求重审已选视图。', 'Adopting sets the project reference and reopens dependent view review.'),
  role('1_concept', 'design_guide', '设计参考 / 配色图', 'Design or palette guide', png, 'overlay', 20,
    '可用作编辑器叠图，不替换原画。', 'Use as an editor overlay without replacing the original.'),
  role('2_views', 'turnaround', '拆件或比例视图', 'Part or balance view', png, 'view', 20,
    '选择 11 个槽位之一；点采用才替换该槽。', 'Assign one of the eleven slots and explicitly adopt the version.'),
  role('3_tripo', 'part_candidate', '头 / 体 / 配饰候选', 'Head, body or accessory candidate', mesh, 'candidate', 128,
    '自包含 GLB 或四边面 FBX，可在本机预览或规范化；采用不会扣 Tripo 额度。', 'Preview an embedded GLB or quad FBX locally; adoption does not spend Tripo credits.'),
  role('4_assembly', 'assembly_scene', '装配场景', 'Assembly scene', blend, 'scene', 128,
    '从外部 Blend 建立不可变编辑修订，不改源文件。', 'Start an immutable edit revision from an external Blend.'),
  role('4_assembly', 'assembly_mesh', '装配部件', 'Assembly part', mesh, 'mesh', 128,
    '向现有编辑修订追加部件（GLB / FBX），不替代已选头体。', 'Append a part (GLB / FBX) to the current editor revision, without replacing chosen candidates.'),
  role('4_assembly', 'base_color', '基色贴图', 'Base color texture', png, 'texture', 20,
    '显式指定对象和材质槽，应用到已有 UV 的基色；不重做 UV。', 'Apply to a named object and material slot with existing UVs; does not unwrap meshes.'),
  role('4_assembly', 'alignment_guide', '比例叠图', 'Proportion overlay', png, 'overlay', 20,
    '正、侧或背参考，可用作编辑器叠图。', 'Use a front, side or back reference in the editor overlay.'),
  role('4_assembly', 'foundation_body', '素体基底（含骨架）', 'Rigged base body', blend, 'scene', 128,
    '素体改型路线。采用后从可信 Blend 建本机修订，保留原骨架、UV、权重和已有形态键。', 'Base route only. Open a trusted rigged Blend; preserve the existing rig, UVs, weights and morphs.'),
  role('4_assembly', 'foundation_head', '头模基底（Blend）', 'Base head scene', blend, 'foundation_head', 128,
    '选择同源面部，或在独立头场景中显式指定眼/口/脸网格和目标骨骼。', 'Use the matching face or name explicit face, eye and mouth meshes plus a target bone.'),
  ...[['clothing','服装','clothing'],['hair','头发','hair'],['accessory','配饰','accessory']].map(([id,zh,en])=>role('4_assembly',`tripo_${id}_reference`,`${zh} · 独立参考 PNG`,`Isolated ${en} reference PNG`,png,'tripo_reference',20,
    '登记后到 Tripo 工单选用（支持 1–4 张多视角）；不会上传私有素体、头模或 Blend。','Choose 1–4 registered PNGs in a Studio ticket; never send the body, head or Blend.')),
  role('4_assembly', 'tripo_clothing', 'Tripo / 外部服装', 'Tripo / external clothing', mesh, 'mesh', 128,
    '仅服装的自包含 GLB 或 FBX。追加后对版、穿模和权重另查。', 'Clothing-only GLB or FBX. Append, then fit and check intersections and weights.'),
  role('4_assembly', 'tripo_hair', 'Tripo / 外部发型', 'Tripo / external hair', mesh, 'mesh', 128,
    '独立于头模（GLB / FBX）。追加后手工对发际线和绑定。', 'A separate hairstyle (GLB / FBX). Append and align the hairline and rig intentionally.'),
  role('4_assembly', 'tripo_accessory', 'Tripo / 外部配饰', 'Tripo / external accessory', mesh, 'mesh', 128,
    '单件配饰（GLB / FBX），不含身体。选明确连接点后另绑。', 'An isolated accessory (GLB / FBX), not a body; attach at an explicit anchor.'),
  role('5_rig_spring', 'rig_scene', '已有骨架 / 权重场景', 'Rigged scene', blend, 'scene', 128,
    '保留已有骨架，从改版副本继续检查。', 'Continue checks in a revision while preserving the existing rig.'),
  role('5_rig_spring', 'weight_mesh', '外部权重参考网格', 'Mesh for weight reference', glb, 'mesh', 128,
    '只追加；转权另选源网格、目标及最大距离。', 'Append only. Weight transfer needs explicit source, targets and distance.'),
  role('5_rig_spring', 'rig_motion', '动作参考 (VRMA)', 'Motion reference (VRMA)', ['.vrma'], 'motion', 32,
    '用于预览 VRM 1.0 的动作，不写入 Blend 或原模型。', 'Play in a VRM 1.0 preview without baking the motion into the model.'),
  role('6_expressions_vrm', 'delivery_scene', '待交付 Blender 场景', 'Delivery Blender scene', blend, 'scene', 128,
    '可导入编辑器核对或另行导出，不替用户验收。', 'Open for inspection and separate export, without automatic approval.'),
  role('6_expressions_vrm', 'review_avatar', '外部 VRM 1.0', 'External VRM 1.0', ['.vrm'], 'avatar', 128,
    '浏览外部 VRM；不登记为本项目导出品。', 'Review an external VRM, not as an export produced by this project.'),
  role('6_expressions_vrm', 'review_motion', '交付验收动作 (VRMA)', 'Delivery review motion (VRMA)', ['.vrma'], 'motion', 32,
    '用于实际动作预览，仍须人工视觉复核。', 'Use for clip playback; visual verification is still required.'),
]);

export function getMaterialRole(stageId, id) {
  const role = MATERIAL_ROLES.find(row => row.stageId === stageId && row.id === id);
  if (!role) throw new Error('素材用途与工序不匹配 / Material role does not belong to this step');
  return role;
}
