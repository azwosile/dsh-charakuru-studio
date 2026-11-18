import { createAccountBudget } from '../providers/account-budget.js';
import { runEditorOperation, cancelEditorJob, collectEditorJob, rollbackEditor, createAiEditRequest, prepareAiEditHandoff, reviewAiEditRequest, setEditorView, editorContent } from '../project/editor.js';
import crypto from 'node:crypto';
import { importStudioAsset, selectStudioAsset, scanGeneratedViews, getAssetContent } from '../project/assets.js';
import { reviewReadiness } from '../project/reviews.js';
import { createProjectRegistry } from '../project/registry.js';
import { imagePreflight } from '../providers/capabilities.js';
import http from 'node:http';
import path from 'node:path';
import { DEFAULT_STUDIO_PORT, REQUIRED_VIEW_SLOTS, PIPELINE_STAGES, PLUGIN_NAME, PLUGIN_VERSION } from '../constants.js';
import { losslessSanitize, okEnvelope, errorEnvelope } from '../contracts/lossless.js';
import { queryModelCatalog, compileTurnaroundPromptPack } from '../catalog/aa-image-hub.js';
import { initOrUpdateProject, loadProjectState, transitionStageCheckpoint, summarizeProjectProgress } from '../project/state.js';
import { runTurnaroundGeneration } from '../providers/image-router.js';
import { planTripoFreeQuotaRun, archiveTripoGlbAsset, TRIPO_STRATEGIES } from '../tripo/free-quota-scheduler.js';
import { probeBlenderPluginLink, runBlenderAvatarStage } from '../blender/bridge.js';

function allowedOrigin(value) {
  if (value === 'dsh-app://app') return true; // Exact origin registered by the official Electron renderer.
  if (!value) return true; // CLI requests have no Origin; browser mutations still require JSON.
  try {
    const u = new URL(value);
    return ['http:', 'https:'].includes(u.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) && u.origin === value;
  } catch { return false; }
}
async function readJsonBody(req, limit = 2 * 1024 * 1024) {
  let total = 0; const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) throw new Error('Request JSON body exceeded size limit');
    chunks.push(chunk);
  }
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error('JSON body must be an object');
  return body;
}
function sendJson(res, code, payload) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(losslessSanitize(payload)));
}
export async function startStudioHttpServer({ port = DEFAULT_STUDIO_PORT, config = {}, credentialManager } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Studio port must be an integer from 0 to 65535');
  const budget = createAccountBudget(config.budgetDir);
  const sessionToken = crypto.randomBytes(32).toString('hex');
  const registry = createProjectRegistry(config.registryFile);
  const allowedOrigins = (config.allowedOrigins || []).filter(Boolean);
  const defaultProjectDir = path.resolve(process.cwd(), 'charakuru-avatar-project');
  const project = (value) => value === undefined || value === '' ? defaultProjectDir : path.resolve(String(value));
  const server = http.createServer(async (req, res) => {
    try {
      const authority = new URL(`http://${req.headers.host || ''}`);
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(authority.hostname) || Number(authority.port) !== server.address().port) {
        sendJson(res, 403, errorEnvelope('HOST_DENIED', 'Expected this loopback server Host')); return;
      }
      const origin = req.headers.origin;
      if (!allowedOrigin(origin) || origin && allowedOrigins.length && !allowedOrigins.includes(origin)) { sendJson(res, 403, errorEnvelope('ORIGIN_DENIED', 'Expected a loopback GUI Origin')); return; }
      if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Charakuru-Session' }); res.end(); return;
      }
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/studio/session') {
        sendJson(res, 200, { sessionToken, version: PLUGIN_VERSION }); return;
      }
      if (req.method === 'GET' && url.pathname === '/studio/editor/content') {
        if (url.searchParams.get('access') !== sessionToken) { sendJson(res,403,errorEnvelope('SESSION_REQUIRED','Reload workbench')); return; }
        const asset = await editorContent(project(url.searchParams.get('projectDir')),url.searchParams.get('revisionId'),url.searchParams.get('kind')||'preview');
        res.writeHead(200,{'Content-Type':asset.mime,'Content-Length':asset.bytes.length,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});res.end(asset.bytes);return;
      }
      if (req.method === 'GET' && url.pathname === '/studio/assets/content') {
        if (url.searchParams.get('access') !== sessionToken) { sendJson(res, 403, errorEnvelope('SESSION_REQUIRED', 'Reload workbench connection')); return; }
        const asset = await getAssetContent(project(url.searchParams.get('projectDir')), url.searchParams.get('id'));
        res.writeHead(200, { 'Content-Type': asset.mime, 'Content-Length': asset.bytes.length, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
        res.end(asset.bytes); return;
      }
      if (req.method === 'GET' && url.pathname === '/health') {
        sendJson(res, 200, okEnvelope({ plugin: PLUGIN_NAME, version: PLUGIN_VERSION, port: server.address().port, defaultProjectDir })); return;
      }
      if (req.method === 'GET' && url.pathname === '/studio/bootstrap') {
        const dir = project(url.searchParams.get('projectDir') || undefined);
        const [loaded, blenderBridge, credentials] = await Promise.all([
          loadProjectState(dir), probeBlenderPluginLink({ blenderPluginUrl: config.blenderPluginUrl }),
          credentialManager ? credentialManager.describeAll() : [],
        ]);
        sendJson(res, 200, okEnvelope({ plugin: PLUGIN_NAME, version: PLUGIN_VERSION, activeProjectDir: dir,
          sessionToken, recentProjects: await registry.list(), runtime: { pluginVersion: PLUGIN_VERSION, node: process.version, platform: process.platform, desktopTarget: '0.2.2-rc.3', uiExecution: 'legacy-direct; gateway-agent-context-required' }, reviewReadiness: await reviewReadiness(dir, loaded.state), requiredViewSlots: REQUIRED_VIEW_SLOTS, stages: PIPELINE_STAGES, projectExists: loaded.exists, projectSummary: summarizeProjectProgress(loaded.state), projectState: loaded.state,
          aaCatalog: queryModelCatalog(), tripoStrategies: Object.values(TRIPO_STRATEGIES), blenderBridge, credentials,
          endpoints: { comfyuiUrl: config.comfyuiUrl || 'http://127.0.0.1:8188', qwenImageUrl: config.qwenImageUrl || 'http://127.0.0.1:8000', openaiCompatBaseUrl: config.openaiCompatBaseUrl || 'https://api.openai.com/v1', blenderPluginUrl: blenderBridge.baseUrl },
        })); return;
      }
      if (req.method !== 'POST') { sendJson(res, 404, errorEnvelope('NOT_FOUND', 'Unknown Studio route')); return; }
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) { sendJson(res, 415, errorEnvelope('JSON_REQUIRED', 'Content-Type must be application/json')); return; }
      if (req.headers['x-charakuru-session'] !== sessionToken) { sendJson(res, 403, errorEnvelope('SESSION_REQUIRED', 'Reload the workbench before modifying project data')); return; }
      const b = await readJsonBody(req, url.pathname === '/studio/assets/import' ? 30 * 1024 * 1024 : undefined), dir = project(b.projectDir);
      let out;
      switch (url.pathname) {
        case '/studio/budget': {
          if(b.action==='configure')out=await budget.configure({accountId:b.accountId,channel:b.channel,period:b.period,limit:b.limit,unit:b.unit});
          else if(b.action==='status')out=await budget.status(b.accountId);
          else if(b.action==='reserve')out=await budget.reserve({accountId:b.accountId,requestId:b.requestId,fingerprint:b.fingerprint,quotedCost:b.quotedCost,quoteExpiresAt:b.quoteExpiresAt,projectId:b.projectId});
          else if(b.action==='transition')out=await budget.transition({accountId:b.accountId,requestId:b.requestId,action:b.transition,actualCost:b.actualCost,providerTaskId:b.providerTaskId,confirmedNotCharged:b.confirmedNotCharged===true});
          else throw new Error('Unknown account ledger action');
          break;
        }
        case '/studio/editor/run': out = await runEditorOperation({projectDir:dir,operation:b.operation,params:b.params,expectedRevisionId:b.expectedRevisionId,blenderPluginUrl:config.blenderPluginUrl||''}); break;
        case '/studio/editor/cancel': out = await cancelEditorJob({projectDir:dir}); break;
        case '/studio/editor/collect': out = await collectEditorJob({projectDir:dir}); break;
        case '/studio/editor/rollback': out = await rollbackEditor({projectDir:dir,revisionId:b.revisionId,expectedRevisionId:b.expectedRevisionId}); break;
        case '/studio/editor/view': out = await setEditorView({projectDir:dir,camera:b.camera,overlayAssetId:b.overlayAssetId,overlayOpacity:b.overlayOpacity}); break;
        case '/studio/editor/ai-request': out = await createAiEditRequest({projectDir:dir,prompt:b.prompt,objects:b.objects,camera:b.camera,expectedRevisionId:b.expectedRevisionId}); break;
        case '/studio/editor/ai-handoff': out = await prepareAiEditHandoff({projectDir:dir,requestId:b.requestId}); break;
        case '/studio/editor/ai-review': out = await reviewAiEditRequest({projectDir:dir,requestId:b.requestId,revisionId:b.revisionId,decision:b.decision}); break;
        case '/studio/project/open': {
          const opened = await registry.remember(dir);
          out = { projectDir: opened.projectDir, projectState: opened.state }; break;
        }
        case '/studio/assets/import': out = await importStudioAsset({ ...b, projectDir: dir }); break;
        case '/studio/assets/select': out = await selectStudioAsset({ projectDir: dir, assetId: b.assetId, expectedRevision: b.expectedRevision }); break;
        case '/studio/assets/scan': out = await scanGeneratedViews({ projectDir: dir }); break;
        case '/studio/views/preflight': {
          const loaded = await loadProjectState(dir);
          out = imagePreflight({ ...b, hasReference: Boolean(loaded.state?.characterSpec?.sourceImages?.length), referenceCount: loaded.state?.characterSpec?.sourceImages?.length || 0 }); break;
        }
        case '/studio/prompts/compile':
          out = { pack: compileTurnaroundPromptPack({ ...b, modelId: b.modelId || config.defaultImageModel || 'qwen-image-2.1-local' }) }; break;
        case '/studio/project/init': {
          const saved = await initOrUpdateProject(dir, { monthlyCreditAllowance: config.tripoMonthlyFreeCredits, ...b });
          await registry.remember(saved.projectDir);
          out = { projectDir: saved.projectDir, projectSummary: summarizeProjectProgress(saved.state), projectState: saved.state }; break;
        }
        case '/studio/project/checkpoint': {
          const saved = await transitionStageCheckpoint(dir, { stageId: b.stageId, action: b.action || 'request_review', notes: b.notes || '', actor: 'user', expectedRevision: b.expectedRevision });
          out = { projectDir: saved.projectDir, projectSummary: summarizeProjectProgress(saved.state), projectState: saved.state }; break;
        }
        case '/studio/views/generate':
          out = await runTurnaroundGeneration({ ...b, allowCloudExecution:config.allowCloudExecution===true, projectDir: dir, modelId: b.modelId || config.defaultImageModel || 'qwen-image-2.1-local',
            endpoints: { comfyuiUrl: b.comfyuiUrl || config.comfyuiUrl, qwenImageUrl: b.qwenImageUrl || config.qwenImageUrl, openaiCompatBaseUrl: b.openaiCompatBaseUrl || config.openaiCompatBaseUrl },
            secrets: credentialManager ? await credentialManager.resolveAllSecrets() : {},
          }); break;
        case '/studio/tripo/plan': out = await planTripoFreeQuotaRun({ projectDir: dir, strategyId: b.strategyId, estimatedCredits: b.estimatedCredits }); break;
        case '/studio/tripo/archive': out = await archiveTripoGlbAsset({ ...b, projectDir: dir }); break;
        case '/studio/blender/stage': out = await runBlenderAvatarStage({ ...b, projectDir: dir, blenderPluginUrl: config.blenderPluginUrl }); break;
        case '/studio/credentials/update':
          if (!credentialManager) throw new Error('Credential manager unavailable');
          if (b.action === 'clear') await credentialManager.clearSecret(b.providerId);
          else if (b.action === 'set') await credentialManager.setSecret(b.providerId, b.secret);
          else throw new Error('Expected credential action set or clear');
          out = { credentials: await credentialManager.describeAll() }; break;
        default: sendJson(res, 404, errorEnvelope('NOT_FOUND', 'Unknown Studio route')); return;
      }
      sendJson(res, 200, okEnvelope(out));
    } catch (err) { sendJson(res, 400, errorEnvelope('STUDIO_ACTION_FAILED', err instanceof Error ? err.message : String(err))); }
  });
  server.requestTimeout = 300000;
  server.headersTimeout = 15000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  return { port: server.address().port, baseUrl: `http://127.0.0.1:${server.address().port}`, getActiveProjectDir: () => defaultProjectDir,
    close: () => new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve())),
  };
}
