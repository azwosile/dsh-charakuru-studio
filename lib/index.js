/**
 * dsh-charakuru-studio — Host Cordis Plugin Entrypoint.
 *
 * Registers:
 *   1. 6 Domain Agent Tools (`charakuru_aa_models`, `charakuru_project`, `charakuru_generate_views`,
 *      `charakuru_tripo_quota`, `charakuru_blender_avatar`, `charakuru_credentials`)
 *   2. Bundled Clean-Room Workflow Skill (`charakuru-vrm-studio`) via `skills.registerProvider`
 *   3. Encrypted Host Credential Store adapter (`ctx.credentials`)
 *   4. Local Studio HTTP API Daemon (`127.0.0.1:9886`) backing the Web GUI Workbench (`lib/client.js`)
 *   5. Deep runtime linkage with `https://github.com/sixtysevenlf/dsh-blender-plugin` (`127.0.0.1:9877`)
 */

import {
  PLUGIN_NAME,
  DEFAULT_STUDIO_PORT,
  DEFAULT_COMFYUI_URL,
  DEFAULT_QWEN_IMAGE_URL,
  DEFAULT_OPENAI_COMPAT_URL,
  TRIPO_FREE_TIER_DEFAULTS,
} from './constants.js';
import { z as nativeSchema, zSafe, schemaDiagnostic } from './contracts/schema.js';
const z = nativeSchema || zSafe;
import { losslessSanitize, redactSecrets } from './contracts/lossless.js';
import { IMAGE_MODEL_CATALOG, compileTurnaroundPromptPack, formatAnimaTags } from './catalog/aa-image-hub.js';
import { createCredentialManager } from './host/credentials.js';
import { registerBundledStudioSkill } from './host/skill.js';
import { startStudioHttpServer } from './host/server.js';
import { buildStudioTools, registerAllStudioTools } from './tools/register-all.js';
import { probeBlenderPluginLink, runBlenderAvatarStage, parseNdjsonBackendBody } from './blender/bridge.js';
import { planTripoFreeQuotaRun, archiveTripoGlbAsset } from './tripo/free-quota-scheduler.js';
import { extractFirstFileFromZip, buildAnimaComfyWorkflow } from './providers/image-router.js';

export const name = PLUGIN_NAME;
export const inject = ['tools', 'skills', 'credentials'];

export const Config = z.object({
  port: z
    .number()
    .default(DEFAULT_STUDIO_PORT)
    .description('Local Studio HTTP port backing the Web GUI Workbench (default 9886).'),
  autoStart: z
    .boolean()
    .default(true)
    .description('Automatically start the local Studio HTTP API daemon on plugin activation.'),
  blenderPluginUrl: z
    .string()
    .default('http://127.0.0.1:9877')
    .description('Companion sixtysevenlf/dsh-blender-plugin HTTP daemon URL.'),
  comfyuiUrl: z
    .string()
    .default(DEFAULT_COMFYUI_URL)
    .description('Local ComfyUI HTTP endpoint for Anima v1.0 & Qwen-Image workflows.'),
  qwenImageUrl: z
    .string()
    .default(DEFAULT_QWEN_IMAGE_URL)
    .description('Local Qwen-Image-2.1 OpenAI-compatible / Diffusers server URL.'),
  openaiCompatBaseUrl: z
    .string()
    .default(DEFAULT_OPENAI_COMPAT_URL)
    .description('Cloud OpenAI-compatible Image API base URL (GPT Image 2.6 / Seedream 5.5 / Gateway).'),
  defaultImageModel: z
    .string()
    .default('qwen-image-2.1-local')
    .description('Default turnaround generation model ID.'),
  tripoMonthlyFreeCredits: z
    .number()
    .default(TRIPO_FREE_TIER_DEFAULTS.monthlyCreditAllowance)
    .description('Monthly free credit budget on Tripo Studio Free Tier (default 200).'),
});

export function apply(ctx, config = {}) {
  const credentialManager = createCredentialManager(ctx);
  let activeServer = null;

  ctx.effect(() => {
    const disposeTools = registerAllStudioTools(ctx, {
      config,
      credentialManager,
      getServer: () => activeServer,
    });
    const disposeSkill = registerBundledStudioSkill(ctx);

    let disposed = false;
    if (config.autoStart !== false) {
      const desiredPort = Number(process.env.DSH_CHARAKURU_PORT ?? config.port ?? DEFAULT_STUDIO_PORT);
      startStudioHttpServer({
        port: desiredPort,
        config,
        credentialManager,
      })
        .then((srv) => {
          if (disposed) {
            srv.close();
            return;
          }
          activeServer = srv;
        })
        .catch((err) => {
          console.error('[dsh-charakuru-studio] Studio startup failed:', err.message);
        });
    }

    return () => {
      disposed = true;
      disposeTools();
      if (typeof disposeSkill === 'function') disposeSkill();
      if (activeServer) {
        const srv = activeServer;
        activeServer = null;
        srv.close().catch(() => {});
      }
    };
  }, 'dsh-charakuru-studio:host-lifecycle');
}

export const __internals = Object.freeze({
  schemaDiagnostic,
  losslessSanitize,
  redactSecrets,
  IMAGE_MODEL_CATALOG,
  compileTurnaroundPromptPack,
  formatAnimaTags,
  buildStudioTools,
  probeBlenderPluginLink,
  runBlenderAvatarStage,
  parseNdjsonBackendBody,
  planTripoFreeQuotaRun,
  archiveTripoGlbAsset,
  extractFirstFileFromZip,
  buildAnimaComfyWorkflow,
});
