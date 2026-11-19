// 3.0.6 legacy HTTP and 3.1 Gateway protocol adapters. Never downgrade a detected Gateway.
export function loopbackOrigin(raw) {
  const u = new URL(raw);
  if (u.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) || u.username || u.password || u.search || u.hash || u.pathname !== '/') throw new Error('Companion URL must be a loopback HTTP origin');
  return u.origin;
}
export function parseBody(text) {
  try { const value = JSON.parse(text); if (value && typeof value === 'object' && !Array.isArray(value)) return value; } catch {}
  for (const line of String(text).split('\n').reverse()) {
    try { const v = JSON.parse(line); if (v && typeof v === 'object' && !v.heartbeat) return v; } catch {}
  }
  throw new Error('Companion returned no structured JSON');
}
export async function requestCompanion(base, route, body, { fetchImpl = fetch, headers = {}, signal, timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  try {
    const res = await fetchImpl(loopbackOrigin(base) + route, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}), signal: controller.signal, redirect: 'error' });
    const value = parseBody(await res.text());
    if (!res.ok || value.ok === false) throw new Error(`Companion ${res.status}: ${String(value.code || value.error || 'request rejected').slice(0,240)}`);
    return value;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
export async function detectCompanion(baseUrl, { fetchImpl = fetch } = {}) {
  const base = loopbackOrigin(baseUrl);
  const health = await requestCompanion(base, '/health', null, { fetchImpl, timeoutMs: 2500 });
  const gateway = health.gateway && typeof health.gateway === 'object' && typeof health.gateway.hostId === 'string';
  const legacy = !Object.hasOwn(health, 'gateway') && health.ok === true && health.stats && health.lease && health.provenance;
  if (!gateway && !legacy) throw new Error('Unknown companion contract; refusing to guess from port alone');
  const protocol = gateway ? 'gateway-3.1' : 'legacy-3.0';
  const doctor = await requestCompanion(base, '/doctor', null, { fetchImpl, timeoutMs: 4000 }).catch(e => ({ kind: 'unavailable', reason: e.message }));
  return { linked: true, baseUrl: base, protocol, health, doctor, guiReady: doctor.kind === 'ok', verdict: doctor.kind === 'ok' ? 'pass' : 'degraded', verification: 'transport_only_not_vrm_quality' };
}
export function callerFromExecution(exec) {
  const agent = exec?.agent, sessionId = agent?.session?.id || agent?.sessionId || exec?.dshSessionId;
  if (!agent?.id || !sessionId) return null;
  const parent = agent.parentAgentId || agent.parent?.id;
  return { hostId: process.env.DSH_HOST_ID || `host-pid-${process.pid}`, dshSessionId: String(sessionId), agentId: String(agent.id), role: parent ? 'subagent' : 'main', ...(parent ? { parentAgentId: String(parent) } : {}) };
}
export function callerHeaders(caller) {
  if (!caller?.hostId || !caller.dshSessionId || !caller.agentId) throw new Error('GATEWAY_CALLER_REQUIRED: 请在 DSH 会话中调用；工作台不得伪造 Agent 身份或绕过会话授权。');
  return { 'x-dsh-host-id': caller.hostId, 'x-dsh-session-id': caller.dshSessionId, 'x-dsh-agent-id': caller.agentId, 'x-dsh-agent-role': caller.role || 'subagent', ...(caller.parentAgentId ? { 'x-dsh-parent-agent-id': caller.parentAgentId } : {}) };
}
export const COMPANION_LEASE_HOLDER = `plugin-pid-${process.pid}`;
export async function releaseCompanionLease(baseUrl, { holder = COMPANION_LEASE_HOLDER, fetchImpl = fetch, signal } = {}) {
  return requestCompanion(baseUrl, '/release', { holder }, { fetchImpl, signal, timeoutMs: 2500 }).catch(() => ({ ok: false }));
}
export async function executeCompanionStage({ connection, scriptFile, outdir, executionTarget, caller, sessionId, fetchImpl = fetch, signal }) {
  const modern = connection.protocol === 'gateway-3.1';
  const headers = modern ? callerHeaders(caller) : {};
  const holder = COMPANION_LEASE_HOLDER;
  if (modern && connection.health.gateway.hostId !== caller.hostId) throw new Error('Gateway belongs to another DSH host; attach through the matching desktop profile');
  if (executionTarget === 'gui_act') {
    if (!connection.guiReady) throw new Error('Blender GUI doctor.kind must be ok before execution');
    if (modern && !sessionId) throw new Error('Gateway GUI execution requires an attached, granted sessionId from blender_session');
    try {
      return await requestCompanion(connection.baseUrl, '/act', { file: scriptFile, holder, ...(modern ? { py: true, sessionId } : {}) }, { fetchImpl, headers, signal, timeoutMs: 180000 });
    } finally {
      if (!modern && fetchImpl === fetch) await releaseCompanionLease(connection.baseUrl, { holder, fetchImpl, signal });
    }
  }
  if (modern) {
    const response = await requestCompanion(connection.baseUrl, '/job', { surface: 'queue', op: 'submit', kind: 'headless', script_file: scriptFile, outdir, factory_startup: false, hard_exit: true, engine: 'eevee' }, { fetchImpl, headers, signal });
    if (!response.job?.id) throw new Error('Gateway submit omitted job id');
    return { ...response, jobId: response.job.id, kind: 'promoted' };
  }
  let promoted = false;
  try {
    const envelope = await requestCompanion(connection.baseUrl, '/headless', { scriptFile, outdir, hardExit: true, useUserConfig: true, engine: 'eevee', holder }, { fetchImpl, signal, timeoutMs: 180000 });
    const run = envelope.result;
    const out = run && typeof run === 'object' && ('exitCode' in run || 'kind' in run || 'jobId' in run) ? { ...run, ok: envelope.ok !== false && run.ok !== false } : envelope;
    promoted = Boolean(out?.jobId || out?.kind === 'promoted');
    return out;
  } finally {
    if (!promoted && fetchImpl === fetch) await releaseCompanionLease(connection.baseUrl, { holder, fetchImpl, signal });
  }
}
export async function collectCompanionJob(pending, { caller, fetchImpl = fetch, signal } = {}) {
  const modern = pending.protocol === 'gateway-3.1';
  const headers = modern ? callerHeaders(caller) : {};
  if (modern && JSON.stringify(caller) !== JSON.stringify(pending.caller)) throw new Error('Only the submitting DSH caller may collect this job');
  const receipt = await requestCompanion(pending.baseUrl, '/job', { ...(modern ? { surface: 'queue' } : {}), op: 'collect', id: pending.jobId, tail: 64000 }, { fetchImpl, headers, signal });
  const job = receipt.job || (typeof (receipt.state || receipt.status) === 'string' ? receipt : null);
  if (!job) throw new Error('Companion collect omitted job');
  const state = job.state || job.status;
  if (!['completed', 'failed', 'canceled', 'cancelled', 'killed', 'stale', 'unknown', 'done', 'exited'].includes(state)) return { pending: true, receipt };
  if (['failed', 'canceled', 'cancelled', 'killed', 'stale', 'unknown'].includes(state)) return { pending: false, failed: true, receipt: { ...receipt, ok: false, error: `Blender job ${state}` } };
  if (modern) return { pending: false, receipt: { ...receipt, exitCode: job.result?.exitCode, resultJson: job.result?.parsed, stdout: job.logs?.stdout || '' } };
  return { pending: false, receipt: { ...receipt, ...job } };
}

export async function cancelCompanionJob(pending,{caller,fetchImpl=fetch,signal}={}) {
  const modern=pending.protocol==='gateway-3.1',headers=modern?callerHeaders(caller):{};
  if(modern&&['hostId','dshSessionId','agentId'].some(k=>caller[k]!==pending.caller?.[k]))throw new Error('Only the submitting caller may cancel this job');
  return requestCompanion(pending.baseUrl,'/job',{...(modern?{surface:'queue'}:{}),op:modern?'cancel':'kill',id:pending.jobId,holder:COMPANION_LEASE_HOLDER},{headers,fetchImpl,signal});
}
