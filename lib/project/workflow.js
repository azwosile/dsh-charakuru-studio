import { loadProjectState, updateProjectState } from './state.js';
import { resolveProjectMaterial } from './materials.js';
import { exclusiveProjectOperation } from './operations.js';

export const WORKFLOW_MODES = Object.freeze(['illustration', 'base_mesh']);
export const initialWorkflow = () => ({ mode: 'illustration', foundation: { body: null, head: null } });
export const PART_RECIPES = Object.freeze({
  clothing: { zh: '服装', en: 'Clothing', role: 'tripo_clothing', brief: '单独生成服装。无人体、脸、头发或配饰；保持 T 姿势的穿戴开口，留出腋下、肘部和胯部活动空间。按肩/胸/腰/胯测量对版，导回后检查内侧、UV 与穿模。' },
  hair: { zh: '头发', en: 'Hair', role: 'tripo_hair', brief: '只生成头发或分束发片，不要脸、眼球和身体；保留发际线、鬓角及头皮贴合空间。主发与有摆动的长发分组，后续单独绑定。' },
  accessory: { zh: '配饰', en: 'Accessory', role: 'tripo_accessory', brief: '一次只生成一件配饰，不要人体、服装或头发；检查连接点、实际尺度、左右方向和背面。硬件可另选骨骼刚性跟随，布件另作权重。' },
});

function expected(state, version) {
  if (!Number.isSafeInteger(version) || version !== state.stateRevision) throw Object.assign(new Error('工程已变化，请重新加载 / Project revision changed'), {statusCode:409});
}
export async function setWorkflowMode({ projectDir, mode, expectedRevision }) {
  if (!WORKFLOW_MODES.includes(mode)) throw new Error('Unknown workbench mode');
  const out = await exclusiveProjectOperation(projectDir, () => updateProjectState(projectDir, state => {
    expected(state, expectedRevision);
    if (state.editor?.pendingJob) throw new Error('Collect the pending editor change first');
    state.workflow ||= initialWorkflow();
    state.workflow.mode = mode;
    state.auditLog.push({ at:new Date().toISOString(), event:'workflow.mode', detail:mode });
  }));
  return { workflow:out.state.workflow, stateRevision:out.state.stateRevision };
}
export async function selectFoundation({ projectDir, part, materialId, expectedRevision }) {
  if (!['body','head'].includes(part)) throw new Error('Choose body or head');
  const out = await exclusiveProjectOperation(projectDir, () => updateProjectState(projectDir, async state => {
    expected(state, expectedRevision);
    if (state.workflow?.mode !== 'base_mesh') throw new Error('Switch this project to the base mesh workflow first');
    if (state.editor?.pendingJob) throw new Error('Collect the pending editor change first');
    if (part==='head' && materialId==='embedded') {
      if (!state.workflow.foundation.body) throw new Error('Adopt the source body before retaining its embedded head');
    } else {
      const material = await resolveProjectMaterial(projectDir, materialId, part === 'body' ? 'scene' : 'foundation_head');
      if (material.record.role !== `foundation_${part}`) throw new Error('Choose the correct registered foundation role');
    }
    state.workflow.foundation[part] = materialId;
    state.auditLog.push({at:new Date().toISOString(),event:'workflow.foundation',detail:`${part}:${materialId}`});
  }));
  return {workflow:out.state.workflow,stateRevision:out.state.stateRevision,applied:false};
}

/** Fail closed if the revision predates a different selected body. Ordinary image-route revisions remain intact. */
export function revisionFromSelectedBody(state, revisionId) {
  const selected = state.workflow?.foundation?.body;
  if (!selected || !revisionId) return false;
  const byId = new Map((state.editor?.revisions || []).map(r => [r.id,r]));
  const seen = new Set();
  for (let r=byId.get(revisionId); r && !seen.has(r.id); r=byId.get(r.parentId)) {
    if (['import_blend','import_checkpoint','import_material_scene'].includes(r.operation)) return r.materialInput?.role === 'foundation_body' && r.materialInput.id === selected;
    seen.add(r.id);
  }
  return false;
}

/** A private, non-executing Tripo plan. Never include the source Blend, FBX, VRM or screenshots. */
export async function planTripoParts({ projectDir, kinds, quotedCredits, budget = 0 }) {
  const loaded = await loadProjectState(projectDir);
  if (!loaded.exists || loaded.state.workflow?.mode !== 'base_mesh') throw new Error('The base mesh workflow must be selected');
  const body = loaded.state.workflow.foundation.body;
  if (!body) throw new Error('Select a local base body first');
  await resolveProjectMaterial(projectDir, body,'scene');
  if (!Array.isArray(kinds) || !kinds.length || kinds.length > 3 || new Set(kinds).size!==kinds.length || kinds.some(k => !Object.hasOwn(PART_RECIPES,k))) throw new Error('Choose clothing, hair or accessory tasks');
  if (!Number.isSafeInteger(budget) || budget < 0 || budget > 100000 || quotedCredits!==undefined && (!Number.isSafeInteger(quotedCredits) || quotedCredits<0 || quotedCredits>100000)) throw new Error('Invalid manual budget or quote');
  const quota=loaded.state.tripoQuota;
  const remaining=Math.max(0,Math.floor(quota.monthlyAllowance-(quota.billingMonth===new Date().toISOString().slice(0,7)?quota.creditsUsed:0)));
  const cap = Math.min(remaining,budget);
  return {projectDir:loaded.projectDir,mode:'manual_parts_only',processing:'sequential',submissions:0,uploads:[],ledgerWrites:0,budget,remaining,cap,
    quotedCredits:quotedCredits??null,withinManualCap:quotedCredits!==undefined && quotedCredits<=cap,
    tasks:kinds.map(kind=>({kind,...PART_RECIPES[kind],input:'user_prepared_isolated_part_only',returnFormat:'GLB'})),
    note:'仅制作衣、发、饰的人工预案，不附素体/头模。提交前在 Tripo 核对每项实际报价、可见性和下载权限；导回工作台后再人工对版。'};
}
