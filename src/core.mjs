import fs from 'node:fs';
import path from 'node:path';
import { createDeterministicZip } from './deterministic-zip.mjs';
import { nowIso, sha256, stableStringify, truncate } from './utils.mjs';

export const ENGINE_VERSION = 'brain2shot-archaeology/1.0.0';
const STOP = new Set('the a an and or but if then else for from with without into onto over under of to in on at by as is are was were be been being this that these those it its they them their we our you your i my me project projects current truth source sources chat chats conversation conversations message messages result results data brain2 ai miner user assistant'.split(/\s+/));
const QUERY_SUFFIXES = ['', 'benchmark', 'experiment', 'failure', 'architecture', 'current', 'superseded', 'decision', 'artifact'];

function textify(value) {
  try { return typeof value === 'string' ? value : stableStringify(value); } catch { return String(value); }
}

function termScore(term) {
  let s = 0;
  if (/^\.[A-Za-z0-9_-]+$/.test(term)) s += 10;
  if (/^[A-Z][A-Z0-9_-]{1,15}$/.test(term)) s += 8;
  if (/[a-z][A-Z]/.test(term)) s += 7;
  if (/\d/.test(term) && /[A-Za-z]/.test(term)) s += 5;
  if (/^[A-Z][A-Za-z0-9._-]{2,}$/.test(term)) s += 3;
  if (term.length >= 4 && term.length <= 24) s += 1;
  return s;
}

export function extractTerms(value, { max = 40 } = {}) {
  const text = textify(value).slice(0, 100000);
  const tokens = text.match(/\.?[A-Za-z][A-Za-z0-9._-]{1,39}/g) ?? [];
  const map = new Map();
  for (const raw of tokens) {
    const term = raw.replace(/[.,;:]+$/, '');
    const normalized = term.toLowerCase();
    if (STOP.has(normalized) || normalized.length < 2) continue;
    const score = termScore(term);
    if (score < 3) continue;
    const prev = map.get(normalized);
    if (!prev || score > prev.score || (score === prev.score && term < prev.term)) map.set(normalized, { term, score });
  }
  return [...map.values()].sort((a,b) => b.score - a.score || a.term.localeCompare(b.term)).slice(0, max).map(x => x.term);
}

export function queryFamily(projectName, term) {
  const out = [];
  for (const suffix of QUERY_SUFFIXES) {
    if (!suffix) out.push(term);
    else out.push(`${term} ${suffix}`);
  }
  if (projectName && projectName.toLowerCase() !== term.toLowerCase()) out.splice(1, 0, `${projectName} ${term}`);
  return [...new Set(out.map(x => x.trim().replace(/\s+/g, ' ')))];
}

function sourceIdentity(source) {
  return String(source?.id ?? source?.sourceId ?? source?.source_id ?? source?.hash ?? source?.sha256 ?? source?.url ?? source?.title ?? '');
}

function sourceFingerprint(bootstrap) {
  const sources = (bootstrap.sources ?? []).map(s => ({
    id: sourceIdentity(s),
    hash: s?.hash ?? s?.sha256 ?? s?.contentHash ?? s?.content_hash ?? null,
    updatedAt: s?.updatedAt ?? s?.updated_at ?? s?.modifiedAt ?? s?.modified_at ?? null
  })).sort((a,b) => stableStringify(a).localeCompare(stableStringify(b)));
  return sha256(stableStringify({ project: bootstrap.project, currentTruth: bootstrap.currentTruth, sources }));
}

function makeWorkGraph(state) {
  const residualNodes = state.residuals.map((r, i) => ({ id: `RES-${String(i+1).padStart(4,'0')}`, type: r.type, target: r.target, status: 'READY', priority: r.priority ?? 50, dependsOn: [] }));
  const queueNodes = state.queue.slice(0, 100).map((q, i) => ({ id: `SEARCH-${String(i+1).padStart(4,'0')}`, type: 'SEARCH', target: q, status: 'READY', priority: 40, dependsOn: [] }));
  return { schema: 'brain2shot-work-graph/v1', nodes: [...residualNodes, ...queueNodes] };
}

function addResidual(state, residual) {
  const key = sha256(stableStringify({ type: residual.type, target: residual.target, evidence: residual.evidence ?? [] }));
  if (!state.residualKeys.includes(key)) {
    state.residualKeys.push(key);
    state.residuals.push({ id: key.slice(0, 16), createdAt: nowIso(), ...residual });
  }
}

function enqueue(state, query) {
  const q = query.trim().replace(/\s+/g, ' ');
  if (!q || state.seenQueries.includes(q) || state.queue.includes(q)) return false;
  if (state.seenQueries.length + state.queue.length >= state.maxQueries) return false;
  state.queue.push(q);
  return true;
}

function addTerm(state, term) {
  const normalized = term.toLowerCase();
  if (state.termKeys.includes(normalized) || state.terms.length >= state.maxTerms) return false;
  state.termKeys.push(normalized);
  state.terms.push(term);
  for (const q of queryFamily(state.projectName, term)) enqueue(state, q);
  return true;
}

export async function startMission(client, store, projectRef, opts = {}) {
  const bootstrap = await client.bootstrap(projectRef);
  const fp = sourceFingerprint(bootstrap);
  const missionId = `B2S-${sha256(`${ENGINE_VERSION}\n${bootstrap.projectId}\n${fp}`).slice(0, 20).toUpperCase()}`;
  const existing = store.get(missionId);
  if (existing) return existing;
  const maxTerms = Number(opts.maxTerms ?? process.env.BRAIN2_MAX_TERMS ?? 80);
  const maxQueries = Number(opts.maxQueries ?? process.env.BRAIN2_MAX_QUERIES ?? 600);
  const state = {
    schema: 'brain2shot-archaeology-mission/v1', engineVersion: ENGINE_VERSION, missionId,
    projectId: bootstrap.projectId, projectName: bootstrap.projectName, sourceFingerprint: fp,
    sourceOfTruth: 'AI_MINER', createdAt: nowIso(), updatedAt: nowIso(), status: 'READY', pass: 0,
    maxTerms, maxQueries, bootstrap, terms: [], termKeys: [], queue: [], seenQueries: [],
    evidence: [], evidenceKeys: [], residuals: [], residualKeys: [], findings: [], events: []
  };
  const seeds = [bootstrap.projectName, ...extractTerms(bootstrap.project), ...extractTerms(bootstrap.currentTruth), ...extractTerms(bootstrap.sources, { max: 50 })];
  for (const term of seeds) if (term) addTerm(state, term);
  state.events.push({ at: nowIso(), type: 'MISSION_STARTED', detail: { sourceFingerprint: fp, seedTerms: state.terms.length, queuedQueries: state.queue.length } });
  return store.save(state);
}

function evidenceKey(query, result) { return sha256(stableStringify({ query, result })); }

function inspectResiduals(state, query, result, resultText) {
  if (!result || (Array.isArray(result) && result.length === 0)) addResidual(state, { type: 'MISSING_EVIDENCE', target: query, priority: 45 });
  const low = resultText.toLowerCase();
  if (/\b(superseded|deprecated|replaced|instead|no longer|contradict|conflict)\b/.test(low)) addResidual(state, { type: 'CANON_REVIEW', target: query, priority: 80 });
  if (/benchmark/.test(query.toLowerCase()) && !/\b\d+(?:\.\d+)?\s*(?:%|x|qps|ms|s|mb|gb|tokens?\/s)\b/i.test(resultText)) addResidual(state, { type: 'LOCATE_BENCHMARK_ARTIFACT', target: query, priority: 70 });
}

export async function advanceMission(client, store, missionId, batchSize = Number(process.env.BRAIN2_DEFAULT_BATCH ?? 8)) {
  const state = store.get(missionId);
  if (!state) throw new Error(`Mission not found: ${missionId}`);
  const n = Math.max(1, Math.min(20, Number(batchSize) || 8));
  state.status = 'RUNNING';
  const processed = [];
  for (let i = 0; i < n && state.queue.length; i++) {
    const query = state.queue.shift();
    if (state.seenQueries.includes(query)) continue;
    state.seenQueries.push(query);
    let bundle;
    try { bundle = await client.search(query, { projectId: state.projectId, mode: 'evidence' }); }
    catch (err) {
      addResidual(state, { type: 'SEARCH_ERROR', target: query, priority: 90, detail: err.message });
      processed.push({ query, error: err.message });
      continue;
    }
    const result = bundle.results;
    const compactResults = result.slice(0, 25);
    const key = evidenceKey(query, compactResults);
    if (!state.evidenceKeys.includes(key)) {
      state.evidenceKeys.push(key);
      state.evidence.push({ key, query, fetchedAt: nowIso(), results: compactResults });
    }
    const resultText = textify(compactResults);
    inspectResiduals(state, query, compactResults, resultText);
    const terms = extractTerms(compactResults, { max: 25 });
    const added = [];
    for (const t of terms) if (addTerm(state, t)) added.push(t);
    processed.push({ query, resultCount: compactResults.length, discoveredTerms: added.slice(0, 15) });
  }
  state.pass += 1;
  if (!state.queue.length) {
    state.status = 'READY_FOR_VERIFICATION';
    addResidual(state, { type: 'UNKNOWN_UNKNOWN_REVIEW', target: state.projectName, priority: 60, detail: 'Query queue exhausted. Inspect orphan evidence, unexplained numbers, unclassified repeated entities, and unresolved canon challenges before terminal PASS.' });
  } else state.status = 'READY';
  state.events.push({ at: nowIso(), type: 'BATCH_COMPLETED', detail: { pass: state.pass, processed: processed.length, remaining: state.queue.length } });
  store.save(state);
  return { missionId, pass: state.pass, status: state.status, processed, remainingQueries: state.queue.length, terms: state.terms.length, evidenceRecords: state.evidence.length, residuals: state.residuals.length };
}

export async function refreshMission(client, store, missionId) {
  const state = store.get(missionId);
  if (!state) throw new Error(`Mission not found: ${missionId}`);
  const bootstrap = await client.bootstrap(state.projectId);
  const nextFp = sourceFingerprint(bootstrap);
  if (nextFp === state.sourceFingerprint) return { changed: false, missionId, sourceFingerprint: nextFp, queuedQueries: state.queue.length };
  const old = state.sourceFingerprint;
  state.sourceFingerprint = nextFp;
  state.bootstrap = bootstrap;
  for (const t of [bootstrap.projectName, ...extractTerms(bootstrap.currentTruth), ...extractTerms(bootstrap.sources, { max: 50 })]) if (t) addTerm(state, t);
  // Always re-run the project itself against the changed source snapshot.
  for (const q of queryFamily(state.projectName, state.projectName)) {
    const idx = state.seenQueries.indexOf(q);
    if (idx >= 0) state.seenQueries.splice(idx, 1);
    enqueue(state, q);
  }
  addResidual(state, { type: 'SOURCE_OF_TRUTH_CHANGED', target: state.projectName, priority: 100, detail: `${old} -> ${nextFp}` });
  state.status = 'READY';
  state.events.push({ at: nowIso(), type: 'SOURCE_REFRESH', detail: { before: old, after: nextFp } });
  store.save(state);
  return { changed: true, missionId, before: old, after: nextFp, queuedQueries: state.queue.length };
}

export function submitFinding(store, missionId, finding) {
  const state = store.get(missionId);
  if (!state) throw new Error(`Mission not found: ${missionId}`);
  const record = {
    id: `F-${sha256(stableStringify(finding)).slice(0,16)}`,
    createdAt: nowIso(), status: 'PROVISIONAL_NOT_CANONICAL', ...finding
  };
  if (!state.findings.some(f => f.id === record.id)) state.findings.push(record);
  state.events.push({ at: nowIso(), type: 'PROVISIONAL_FINDING', detail: { findingId: record.id } });
  store.save(state);
  return record;
}

function manifestFor(entries) {
  return Object.fromEntries(Object.keys(entries).sort().map(name => [name, sha256(Buffer.from(entries[name]))]));
}

export function exportMission(store, missionId, outputDir = path.resolve(process.env.BRAIN2_MISSION_DATA_DIR ?? './data', 'exports')) {
  const state = store.get(missionId);
  if (!state) throw new Error(`Mission not found: ${missionId}`);
  const graph = makeWorkGraph(state);
  const nextReady = graph.nodes.filter(n => n.status === 'READY').sort((a,b) => b.priority-a.priority || a.id.localeCompare(b.id)).slice(0,50);
  const root = `${state.projectName.replace(/[^A-Za-z0-9._-]+/g,'_')}_BRAIN2SHOT_${missionId}`;
  const entries = {};
  const put = (rel, content) => { entries[`${root}/${rel}`] = typeof content === 'string' ? content : stableStringify(content, 2) + '\n'; };
  put('00_START_HERE/START_HERE.md', `# Brain2Shot Mission Snapshot\n\nSource of truth: **AI Miner**.\n\nProject: **${state.projectName}**\nMission: \`${state.missionId}\`\nSource fingerprint: \`${state.sourceFingerprint}\`\n\nThis ZIP is a portable snapshot. If AI Miner is available, refresh against AI Miner before treating this snapshot as current.\n`);
  put('01_MISSION/MASTER_MISSION.md', `# Master Mission\n\nReconstruct ${state.projectName} from AI Miner evidence, distinguish history from current canon, surface contradictions and missing proof, verify findings, and continue from residual work until bounded stop conditions pass.\n`);
  put('02_STATE_OF_TRUTH/AI_MINER_BOOTSTRAP.json', state.bootstrap);
  put('03_ARCHAEOLOGY/MISSION_STATE.json', state);
  put('03_ARCHAEOLOGY/EVIDENCE.json', state.evidence);
  put('03_ARCHAEOLOGY/RESIDUALS.json', state.residuals);
  put('03_ARCHAEOLOGY/FINDINGS_PROVISIONAL.json', state.findings);
  put('10_RUNTIME/CURRENT_WORK_GRAPH.json', graph);
  put('10_RUNTIME/NEXT_READY.json', nextReady);
  put('10_RUNTIME/BRAIN2SHOT_RUNTIME_RULES.md', `# Brain2Shot Runtime Rules\n\n1. AI Miner is the only source of truth.\n2. Historical evidence never overwrites Current Truth by itself.\n3. A finding is provisional until verification.\n4. Search exact names, aliases, experiments, failures, architecture, current and superseded variants.\n5. A blocker blocks dependent work only.\n6. Every result must produce either evidence, a residual, or an explicit bounded negative result.\n7. When obvious work is exhausted, run unknown-unknown review.\n8. Preserve failures and contradictions.\n9. Exported ZIPs are snapshots, not live truth.\n`);
  put('10_RUNTIME/VEGA_VERIFIER_CANON.md', `# VEGA Verifier Canon\n\nAllowed decisions: VERIFIED_BOUNDED, REJECTED, INCONCLUSIVE, BLOCKED, RETURN_FOR_REPAIR.\n\nVerify provenance, exact source references, bounded claim wording, contradiction coverage, current-vs-historical classification, and reproducibility where an experiment is claimed.\n`);
  const manifest = manifestFor(entries);
  put('SHA256_MANIFEST.json', manifest);
  put('MANIFEST.json', { schema: 'brain2shot-snapshot/v1', sourceOfTruth: 'AI_MINER', snapshot: true, engineVersion: state.engineVersion, missionId: state.missionId, projectId: state.projectId, sourceFingerprint: state.sourceFingerprint });
  const out = path.join(outputDir, `${root}.zip`);
  const zip = createDeterministicZip(entries, out);
  return { path: out, bytes: zip.length, sha256: sha256(zip), files: Object.keys(entries).length };
}

export function summarizeState(state) {
  return {
    missionId: state.missionId, projectId: state.projectId, projectName: state.projectName,
    sourceOfTruth: state.sourceOfTruth, sourceFingerprint: state.sourceFingerprint, status: state.status,
    pass: state.pass, terms: state.terms.length, queuedQueries: state.queue.length, searchedQueries: state.seenQueries.length,
    evidenceRecords: state.evidence.length, residuals: state.residuals.length, provisionalFindings: state.findings.length,
    nextQueries: state.queue.slice(0, 20), topResiduals: state.residuals.slice().sort((a,b)=>(b.priority??0)-(a.priority??0)).slice(0,20)
  };
}

export function safeResultText(value) { return truncate(value, 40000); }
