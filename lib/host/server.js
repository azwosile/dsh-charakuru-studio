import http from 'node:http';
import path from 'node:path';
import { DEFAULT_STUDIO_PORT, PIPELINE_STAGES, PLUGIN_NAME, PLUGIN_VERSION } from '../constants.js';
import { losslessSanitize, okEnvelope, errorEnvelope } from '../contracts/lossless.js';
import { queryModelCatalog, compileTurnaroundPromptPack } from '../catalog/aa-image-hub.js';
import { initOrUpdateProject, loadProjectState, transitionStageCheckpoint, summarizeProjectProgress } from '../project/state.js';
import { runTurnaroundGeneration } from '../providers/image-router.js';
import { planTripoFreeQuotaRun, archiveTripoGlbAsset, TRIPO_STRATEGIES } from '../tripo/free-quota-scheduler.js';
import { probeBlenderPluginLink, runBlenderAvatarStage } from '../blender/bridge.js';

function allowedOrigin(value) {
  if (!value) return true; // CLI requests have no Origin; browser mutations still require JSON.
  try {
    const u = new URL(value);
    return ['http:', 'https:'].includes(u.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) && u.origin === value;
  } catch { return false; }
}
async function readJsonBody(req) {
  let total = 0; const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 2 * 1024 * 1024) throw new Error('Request JSON body exceeded 2 MiB limit');
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
  const defaultProjectDir = path.resolve(process.cwd(), 'charakuru-avatar-project');
  const project = (value) => value === undefined || value === '' ? defaultProjectDir : path.resolve(String(value));
  const server = http.createServer(async (req, res) => {
    try {
      const authority = new URL(`http://${req.headers.host || ''}`);
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(authority.hostname) || Number(authority.port) !== server.address().port) {
        sendJson(res, 403, errorEnvelope('HOST_DENIED', 'Expected this loopback server Host')); return;
      }
      const origin = req.headers.origin;
      if (!allowedOrigin(origin)) { sendJson(res, 403, errorEnvelope('ORIGIN_DENIED', 'Expected a loopback GUI Origin')); return; }
      if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }); res.end(); return;
      }
      const url = new URL(req.url || '/', 'http://127.0.0.1');
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
          stages: PIPELINE_STAGES, projectExists: loaded.exists, projectSummary: summarizeProjectProgress(loaded.state), projectState: loaded.state,
          aaCatalog: queryModelCatalog(), tripoStrategies: Object.values(TRIPO_STRATEGIES), blenderBridge, credentials,
          endpoints: { comfyuiUrl: config.comfyuiUrl || 'http://127.0.0.1:8188', qwenImageUrl: config.qwenImageUrl || 'http://127.0.0.1:8000', openaiCompatBaseUrl: config.openaiCompatBaseUrl || 'https://api.openai.com/v1', blenderPluginUrl: blenderBridge.baseUrl },
        })); return;
      }
      if (req.method !== 'POST') { sendJson(res, 404, errorEnvelope('NOT_FOUND', 'Unknown Studio route')); return; }
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) { sendJson(res, 415, errorEnvelope('JSON_REQUIRED', 'Content-Type must be application/json')); return; }
      const b = await readJsonBody(req), dir = project(b.projectDir);
      let out;
      switch (url.pathname) {
        case '/studio/prompts/compile':
          out = { pack: compileTurnaroundPromptPack({ ...b, modelId: b.modelId || config.defaultImageModel || 'qwen-image-2.1-local' }) }; break;
        case '/studio/project/init': {
          const saved = await initOrUpdateProject(dir, { monthlyCreditAllowance: config.tripoMonthlyFreeCredits, ...b });
          out = { projectDir: saved.projectDir, projectSummary: summarizeProjectProgress(saved.state), projectState: saved.state }; break;
        }
        case '/studio/project/checkpoint': {
          const saved = await transitionStageCheckpoint(dir, { stageId: b.stageId, action: b.action || 'request_review', notes: b.notes || '', actor: 'user' });
          out = { projectDir: saved.projectDir, projectSummary: summarizeProjectProgress(saved.state), projectState: saved.state }; break;
        }
        case '/studio/views/generate':
          out = await runTurnaroundGeneration({ ...b, projectDir: dir, modelId: b.modelId || config.defaultImageModel || 'qwen-image-2.1-local',
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
