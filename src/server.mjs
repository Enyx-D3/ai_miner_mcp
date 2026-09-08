import http from 'node:http';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import * as z from 'zod/v4';
import { AiMinerClient } from './ai-miner-client.mjs';
import { BrowserBridgeHub } from './browser-bridge-hub.mjs';
import { MissionStore } from './mission-store.mjs';
import { compileBrain2Mission, runBrain2Mission } from './mission-engine.mjs';
import { advanceMission, exportMission, refreshMission, safeResultText, startMission, submitFinding, summarizeState } from './core.mjs';
import { Brain2RuntimeWorker } from '../runtime/v1/worker.mjs';
import { runClosedLoopExecution } from '../runtime/v1/closed-loop.mjs';

const bridgeHub = new BrowserBridgeHub();
const client = new AiMinerClient({ bridgeHub });
const store = new MissionStore();
const runtimeWorker = new Brain2RuntimeWorker({ stateDir: process.env.BRAIN2_RUNTIME_STATE_DIR ?? '.brain2-runtime' });
const MCP_PATH = process.env.MCP_PATH ?? '/mcp';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const AUTH_MODE = process.env.MCP_AUTH_MODE ?? (IS_PRODUCTION ? 'bearer' : 'none');
const SHARED = process.env.MCP_SHARED_SECRET ?? '';
const BRIDGE_TOKEN = process.env.BRAIN2_BRIDGE_TOKEN ?? '';
const BRIDGE_ALLOWED_ORIGINS = new Set((process.env.BRAIN2_BRIDGE_ALLOWED_ORIGINS ?? 'http://127.0.0.1:3000,http://localhost:3000').split(',').map(x => x.trim()).filter(Boolean));
const MAX_BRIDGE_BODY = Number(process.env.BRAIN2_BRIDGE_MAX_BODY_BYTES ?? 8 * 1024 * 1024);

if (IS_PRODUCTION && (AUTH_MODE !== 'bearer' || !SHARED)) {
  throw new Error('Production MCP requires MCP_AUTH_MODE=bearer and a non-empty MCP_SHARED_SECRET.');
}
if (IS_PRODUCTION && !BRIDGE_TOKEN) {
  throw new Error('Production browser bridge requires BRAIN2_BRIDGE_TOKEN.');
}

function jsonContent(value) { return { content: [{ type: 'text', text: safeResultText(value) }] }; }
function toolError(err) { return { content: [{ type: 'text', text: `${err.name ?? 'Error'}: ${err.message}` }], isError: true }; }

function createBrain2Server() {
  const CHATGPT_READ_ONLY = process.env.BRAIN2_CHATGPT_READ_ONLY === '1';

  const READ_ONLY_ANNOTATIONS = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false
  };

  const server = new McpServer(
    { name: 'Brain2 AI Miner', version: '1.1.0' },
    { instructions: `AI Miner browser IndexedDB is the sole source of truth. Keep the AI Miner web tab open so the local Browser Bridge can answer MCP requests. Always bootstrap a project before archaeology. Findings are provisional and must never overwrite AI Miner Current Truth. If new chats arrive, call archaeology_refresh. Exported Brain2Shot ZIPs are snapshots only.` }
  );

  server.registerTool('brain2_health', {
    description: 'Check the live AI Miner browser bridge and MCP integration health.',
    annotations: READ_ONLY_ANNOTATIONS
  }, async () => {
    try { return jsonContent(await client.probe()); } catch (e) { return toolError(e); }
  });

  server.registerTool('brain2_list_projects', {
    description: 'List projects from the live AI Miner browser IndexedDB source of truth.',
    annotations: READ_ONLY_ANNOTATIONS
  }, async () => {
    try { return jsonContent(await client.listProjects()); } catch (e) { return toolError(e); }
  });

  server.registerTool('brain2_project_bootstrap', {
    description: 'Load a project, Current Truth and source inventory from AI Miner browser IndexedDB. Call before deep archaeology.',
    annotations: READ_ONLY_ANNOTATIONS,
    inputSchema: z.object({ project: z.string().min(1) })
  }, async ({ project }) => { try { return jsonContent(await client.bootstrap(project)); } catch (e) { return toolError(e); } });

  server.registerTool('brain2_search', {
    description: 'Search live AI Miner evidence. Results come from AI Miner browser IndexedDB, not the MCP mission cache.',
    annotations: READ_ONLY_ANNOTATIONS,
    inputSchema: z.object({ query: z.string().min(1), projectId: z.string().optional(), mode: z.string().default('evidence') })
  }, async ({ query, projectId, mode }) => { try { return jsonContent(await client.search(query, { projectId, mode })); } catch (e) { return toolError(e); } });

  server.registerTool('brain2_sync_proof', {
    description: 'Return a deterministic live Web sync proof from AI Miner browser IndexedDB for G11 cross-surface convergence verification.',
    annotations: READ_ONLY_ANNOTATIONS
  }, async () => {
    try { return jsonContent(await client.syncProof()); }
    catch (e) { return toolError(e); }
  });

  server.registerTool('brain2_inventory', {
    description: 'Return the live AI Miner corpus inventory and deterministic search-index coverage so ChatGPT can know what is actually searchable.',
    annotations: READ_ONLY_ANNOTATIONS
  }, async () => {
    try {
      return jsonContent(await client.inventory());
    } catch (e) {
      return toolError(e);
    }
  });

  server.registerTool('brain2_search_all', {
    description: 'Exhaustively page through deterministic AI Miner search matches for a query or an explicit project. Use query="*" with projectId to enumerate all indexed messages, atoms, and truths for that project.',
    inputSchema: z.object({
      query: z.string().min(1),
      projectId: z.string().optional(),
      mode: z.string().default('evidence'),
      pageLimit: z.number().int().min(1).max(200).default(200),
      maxResults: z.number().int().min(1).max(5000).default(2000),
      maxPages: z.number().int().min(1).max(100).default(50)
    }),
    annotations: READ_ONLY_ANNOTATIONS
  }, async ({ query, projectId, mode, pageLimit, maxResults, maxPages }) => {
    try {
      return jsonContent(await client.searchAll(query, {
        projectId,
        mode,
        pageLimit,
        maxResults,
        maxPages
      }));
    } catch (e) {
      return toolError(e);
    }
  });

  server.registerTool('brain2_compile_mission', {
    description: 'Compile a normal user prompt into a deterministic Brain2 mission: resolve likely projects, enhance the task contract, and create a deep-search plan without modifying AI Miner.',
    inputSchema: z.object({
      prompt: z.string().min(1),
      projectHint: z.string().optional(),
      maxBootstrapProjects: z.number().int().min(0).max(5).default(3)
    }),
    annotations: READ_ONLY_ANNOTATIONS
  }, async ({ prompt, projectHint, maxBootstrapProjects }) => {
    try {
      const effectivePrompt = projectHint ? `${prompt}\nProject hint: ${projectHint}` : prompt;
      return jsonContent(await compileBrain2Mission(client, effectivePrompt, { maxBootstrapProjects }));
    } catch (e) { return toolError(e); }
  });

  server.registerTool('brain2_run_mission', {
    description: 'Run the Brain2Exporter read-only mission workflow for a user prompt: resolve projects, enhance the prompt, perform bounded deep search across AI Miner evidence, run a residual search pass, and return a context pack for ChatGPT.',
    inputSchema: z.object({
      prompt: z.string().min(1),
      projectHint: z.string().optional(),
      maxQueries: z.number().int().min(4).max(40).default(20),
      maxEvidence: z.number().int().min(10).max(200).default(80),
      maxBootstrapProjects: z.number().int().min(0).max(5).default(3)
    }),
    annotations: READ_ONLY_ANNOTATIONS
  }, async ({ prompt, projectHint, maxQueries, maxEvidence, maxBootstrapProjects }) => {
    try {
      const effectivePrompt = projectHint ? `${prompt}\nProject hint: ${projectHint}` : prompt;
      return jsonContent(await runBrain2Mission(client, effectivePrompt, { maxQueries, maxEvidence, maxBootstrapProjects }));
    } catch (e) { return toolError(e); }
  });

  if (CHATGPT_READ_ONLY) return server;

  server.registerTool('brain2_runtime_execute', {
    description: 'Execute one bounded R1-authorized Brain2 Runtime capability against an existing canonical B2JOB and return a proof-carrying B2RESULT. This never directly mutates AI Miner Current Truth.',
    inputSchema: z.object({
      b2job: z.record(z.string(), z.unknown()),
      request: z.record(z.string(), z.unknown()),
      hypothesis: z.object({ id: z.string().min(1).optional(), statement: z.string().min(1).optional() }).optional()
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, async ({ b2job, request, hypothesis }) => {
    try { return jsonContent(await runClosedLoopExecution({ worker: runtimeWorker, b2job, request, hypothesis })); }
    catch (e) { return toolError(e); }
  });

  server.registerTool('brain2_archaeology_start', {
    description: 'Start or resume a deterministic archaeology mission from the current AI Miner browser snapshot.',
    inputSchema: z.object({ project: z.string().min(1) })
  }, async ({ project }) => { try { const s = await startMission(client, store, project); return jsonContent(summarizeState(s)); } catch (e) { return toolError(e); } });

  server.registerTool('brain2_archaeology_next', {
    description: 'Execute the next bounded deterministic archaeology search batch against live AI Miner evidence.',
    inputSchema: z.object({ missionId: z.string().min(1), batchSize: z.number().int().min(1).max(20).default(8) })
  }, async ({ missionId, batchSize }) => { try { return jsonContent(await advanceMission(client, store, missionId, batchSize)); } catch (e) { return toolError(e); } });

  server.registerTool('brain2_archaeology_state', {
    description: 'Read durable archaeology execution state. This is mission execution state, not canonical AI Miner truth.',
    inputSchema: z.object({ missionId: z.string().min(1) })
  }, async ({ missionId }) => { try { const s = store.get(missionId); if (!s) throw new Error('Mission not found'); return jsonContent(summarizeState(s)); } catch (e) { return toolError(e); } });

  server.registerTool('brain2_archaeology_refresh', {
    description: 'Compare a mission with the latest AI Miner browser source snapshot and enqueue work for new chat deltas.',
    inputSchema: z.object({ missionId: z.string().min(1) })
  }, async ({ missionId }) => { try { return jsonContent(await refreshMission(client, store, missionId)); } catch (e) { return toolError(e); } });

  server.registerTool('brain2_submit_finding', {
    description: 'Store a PROVISIONAL archaeology finding in mission execution state. This never changes AI Miner Current Truth.',
    inputSchema: z.object({
      missionId: z.string().min(1),
      claim: z.string().min(1),
      classification: z.enum(['HISTORICAL','CURRENT_SUPPORT','CONTRADICTION','FAILURE','EXPERIMENT','MISSING_EVIDENCE','OTHER']),
      evidenceRefs: z.array(z.string()).default([]),
      notes: z.string().optional()
    })
  }, async ({ missionId, ...finding }) => { try { return jsonContent(submitFinding(store, missionId, finding)); } catch (e) { return toolError(e); } });

  server.registerTool('brain2_export_mission', {
    description: 'Compile a deterministic portable Brain2Shot ZIP snapshot. AI Miner remains the live source of truth.',
    inputSchema: z.object({ missionId: z.string().min(1) })
  }, async ({ missionId }) => { try { return jsonContent(exportMission(store, missionId)); } catch (e) { return toolError(e); } });

  return server;
}

const handler = createMcpHandler(createBrain2Server);
const nodeMcp = toNodeHandler(handler, { onerror: err => console.error('[mcp adapter]', err) });

function authorized(req) {
  if (AUTH_MODE === 'none') return true;
  if (AUTH_MODE !== 'bearer' || !SHARED) return false;
  return req.headers.authorization === `Bearer ${SHARED}`;
}

function bridgeAuthorized(req) {
  if (!BRIDGE_TOKEN) return false;
  return req.headers.authorization === `Bearer ${BRIDGE_TOKEN}`;
}

function setCors(req, res) {
  const origin = String(req.headers.origin ?? '');
  if (origin && BRIDGE_ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'Origin');
    res.setHeader('access-control-allow-headers', 'authorization,content-type');
    res.setHeader('access-control-allow-methods', 'POST,OPTIONS');
  }
  return !origin || BRIDGE_ALLOWED_ORIGINS.has(origin);
}

async function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BRIDGE_BODY) {
        reject(new Error('Bridge request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch (e) { reject(new Error(`Invalid JSON: ${e.message}`)); }
    });
    req.on('error', reject);
  });
}

function writeJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (url.pathname.startsWith('/bridge/')) {
    const corsOk = setCors(req, res);
    if (req.method === 'OPTIONS') {
      res.writeHead(corsOk ? 204 : 403);
      res.end();
      return;
    }
    if (!corsOk) { writeJson(res, 403, { error: 'Origin not allowed' }); return; }
    if (!bridgeAuthorized(req)) { writeJson(res, 401, { error: 'Unauthorized bridge' }); return; }

    try {
      if (url.pathname === '/bridge/poll' && req.method === 'POST') {
        const body = await readJson(req);
        const command = await bridgeHub.poll(body);
        if (!command) { res.writeHead(204, { 'cache-control': 'no-store' }); res.end(); return; }
        writeJson(res, 200, command);
        return;
      }
      if (url.pathname === '/bridge/respond' && req.method === 'POST') {
        const body = await readJson(req);
        writeJson(res, 200, bridgeHub.respond(body));
        return;
      }
      if (url.pathname === '/bridge/status' && req.method === 'POST') {
        writeJson(res, 200, bridgeHub.status());
        return;
      }
      writeJson(res, 404, { error: 'Bridge route not found' });
      return;
    } catch (error) {
      writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
      return;
    }
  }

  if (url.pathname === '/healthz') {
    writeJson(res, 200, { ok: true, service: 'brain2-ai-miner-chatgpt-mcp', aiMinerTransport: 'browser-indexeddb', bridge: bridgeHub.status() });
    return;
  }

  if (url.pathname !== MCP_PATH) { res.writeHead(404); res.end('Not found'); return; }
  if (!authorized(req)) { res.writeHead(401, { 'www-authenticate': 'Bearer' }); res.end('Unauthorized'); return; }
  await nodeMcp(req, res);
});

const bind = process.env.MCP_BIND ?? '127.0.0.1';
const port = Number(process.env.MCP_PORT ?? 8787);
server.listen(port, bind, () => console.error(`Brain2 AI Miner MCP listening on http://${bind}:${port}${MCP_PATH}; browser bridge /bridge/*`));

for (const sig of ['SIGINT','SIGTERM']) process.on(sig, () => {
  try { store.close(); } catch {}
  server.close(() => process.exit(0));
});
