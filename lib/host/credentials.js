import { CREDENTIAL_PROVIDERS } from '../constants.js';

export function createCredentialManager(ctx) {
  const service = () => ctx?.get?.('credentials') || ctx?.credentials;
  function providerFor(id) {
    const provider = CREDENTIAL_PROVIDERS.find((row) => row.id === id);
    if (!provider) throw new Error(`Unknown credential provider: ${id}`);
    return provider;
  }
  async function resolveSecret(id) {
    const provider = providerFor(id);
    const svc = service();
    const record = svc ? await svc.readRecord(provider.recordKey) : null;
    if (record?.kind === 'api-key' && typeof record.key === 'string' && record.key.trim()) return record.key.trim();
    return String(process.env[provider.envName] || '').trim();
  }
  async function resolveAllSecrets() {
    return Object.fromEntries(await Promise.all(CREDENTIAL_PROVIDERS.map(async (provider) => [provider.id, await resolveSecret(provider.id)])));
  }
  async function describeAll() {
    const svc = service();
    return Promise.all(CREDENTIAL_PROVIDERS.map(async (provider) => {
      const info = svc ? await svc.describeRecord(provider.recordKey) : { configured: false, writable: false };
      const env = Boolean(String(process.env[provider.envName] || '').trim());
      return { ...provider, configured: Boolean(info.configured || env), writable: Boolean(info.writable), source: info.configured ? 'host_credentials' : env ? 'process_env' : 'none' };
    }));
  }
  async function setSecret(id, value) {
    const provider = providerFor(id);
    if (typeof value !== 'string' || !value.trim()) throw new Error('Secret must be a non-empty string');
    const svc = service();
    if (!svc) throw new Error('Host credentials service unavailable; configure an environment variable instead');
    await svc.modifyRecord(provider.recordKey, async () => ({ kind: 'api-key', key: value.trim() }));
    return { storedIn: 'host_credentials', providerId: id };
  }
  async function clearSecret(id) {
    const provider = providerFor(id);
    const svc = service();
    if (!svc) throw new Error('Host credentials service unavailable');
    await svc.deleteRecord(provider.recordKey);
    return { cleared: true, providerId: id, environmentFallbackRemains: Boolean(process.env[provider.envName]) };
  }
  return { resolveSecret, resolveAllSecrets, describeAll, setSecret, clearSecret };
}
