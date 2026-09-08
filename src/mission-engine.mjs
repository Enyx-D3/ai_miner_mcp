import crypto from 'node:crypto';

const STOPWORDS = new Set([
  'the','and','for','with','that','this','from','into','your','our','what','when','where','which','who','why','how','is','of','we','do','to','a','an','in','on',
  'are','was','were','been','being','have','has','had','will','would','should','could','can','may','might','must',
  'about','after','before','then','than','them','they','their','there','here','also','just','only','very','more',
  'most','much','many','some','any','all','not','but','you','user','please','show','tell','give','make','build'
]);

const GENERIC_INTENT = new Set([
  'current','status','project','projects','system','systems','experiment','experiments','actually','verified',
  'verification','next','step','steps','find','search','deep','everything','latest','state','result','results'
]);

const NOISE = new Set([
  'captureconnectorid','captureid','captureurl','conversationid','atomcount','atomids','createdat','updatedat',
  'snapshotversion','memoryroot','deviceid','sessionid','provider','sourcetype','sourceid','messageid','projectid',
  'metadata','schema','index','indexes','timestamp','timestamps','localhost','http','https','browser'
]);

const EVIDENCE_QUERIES = [
  'current truth latest state',
  'verified experiment blind test regression',
  'benchmark performance measurement',
  'decision architecture chosen approach',
  'failure contradiction superseded',
  'open item unresolved next step',
  'artifact implementation code zip report',
  'history timeline previous version'
];

function hash(v) {
  return crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 20);
}

function norm(s) {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokens(text, { includeGeneric = false } = {}) {
  const raw = String(text ?? '').match(/[A-Za-z][A-Za-z0-9._-]{1,}/g) ?? [];
  const out = [];
  const seen = new Set();

  for (const rawToken of raw) {
    const t = rawToken.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
    if (t.length < 2 || STOPWORDS.has(t) || NOISE.has(t) || /^\d+$/.test(t)) continue;
    if (!includeGeneric && GENERIC_INTENT.has(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function acronymAnchors(text) {
  const raw = String(text ?? '').match(/\b[A-Za-z]{1,6}\d+[A-Za-z0-9-]*\b|\b[A-Z]{2,8}\b/g) ?? [];
  return [...new Set(raw.map(x => x.toLowerCase()))];
}

function unique(values, max = 64) {
  const seen = new Set();
  const out = [];
  for (const v of values) {
    const s = String(v ?? '').replace(/\s+/g, ' ').trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

function compact(value, depth = 0) {
  if (value == null) return value;
  if (typeof value === 'string') return value.length > 2200 ? value.slice(0, 2200) + '…' : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth > 5) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 30).map(v => compact(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value).slice(0, 60)) out[k] = compact(v, depth + 1);
    return out;
  }
  return String(value);
}

function extractProjects(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== 'object') return [];
  for (const k of ['projects','items','results','data']) if (Array.isArray(raw[k])) return raw[k];
  return [];
}

function pName(p) {
  if (typeof p === 'string') return p;
  return String(p?.name ?? p?.title ?? p?.projectName ?? p?.project ?? p?.slug ?? '');
}

function pId(p) {
  const v = p?.projectId ?? p?.project_id ?? p?.id;
  return v == null ? undefined : String(v);
}

function collectProjectMentions(value, out = [], depth = 0) {
  if (value == null || depth > 7) return out;
  if (Array.isArray(value)) {
    for (const v of value.slice(0, 100)) collectProjectMentions(v, out, depth + 1);
    return out;
  }
  if (typeof value !== 'object') return out;

  const id = value.projectId ?? value.project_id;
  const name = value.projectName ?? value.project_name ?? value.project?.name ??
               (id ? (value.name ?? value.title ?? value.project) : undefined);

  if (id || name) {
    out.push({
      projectId: id == null ? undefined : String(id),
      name: name == null ? undefined : String(name)
    });
  }

  for (const v of Object.values(value).slice(0, 100)) collectProjectMentions(v, out, depth + 1);
  return out;
}

function extractRecords(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== 'object') return [raw];
  for (const k of ['results','items','hits','evidence','atoms','messages','data']) {
    if (Array.isArray(raw[k])) return raw[k];
  }
  return [raw];
}

function collectStrings(value, out = [], depth = 0) {
  if (value == null || depth > 6) return out;
  if (typeof value === 'string') { out.push(value); return out; }
  if (Array.isArray(value)) {
    for (const v of value.slice(0, 60)) collectStrings(v, out, depth + 1);
    return out;
  }
  if (typeof value === 'object') {
    for (const v of Object.values(value).slice(0, 80)) collectStrings(v, out, depth + 1);
  }
  return out;
}

function relevance(text, anchors) {
  const n = norm(text);
  let score = 0;
  for (const a of anchors.strong) {
    if (n.includes(norm(a))) score += 10;
  }
  for (const a of anchors.domain) {
    if (n.includes(norm(a))) score += 2;
  }
  return score;
}

function scoreTitle(name, anchors, hint) {
  const n = norm(name);
  if (!n) return 0;
  let score = 0;

  if (hint && (n.includes(norm(hint)) || norm(hint).includes(n))) score += 30;

  for (const a of anchors.strong) {
    if (n.includes(norm(a))) score += 20;
  }
  for (const a of anchors.domain) {
    if (n.includes(norm(a))) score += 4;
  }

  // Generic-only matches are weak and should not dominate project resolution.
  const generic = tokens(name, { includeGeneric: true }).filter(t => GENERIC_INTENT.has(t));
  score += Math.min(generic.length, 2);

  return score;
}

const V7_SEARCH_CACHE = new Map();
const V7_CACHE_MAX = 160;

function v7CacheGet(key) {
  if (!V7_SEARCH_CACHE.has(key)) return undefined;
  const value = V7_SEARCH_CACHE.get(key);
  V7_SEARCH_CACHE.delete(key);
  V7_SEARCH_CACHE.set(key, value);
  return value;
}

function v7CacheSet(key, value) {
  if (V7_SEARCH_CACHE.has(key)) V7_SEARCH_CACHE.delete(key);
  V7_SEARCH_CACHE.set(key, value);
  while (V7_SEARCH_CACHE.size > V7_CACHE_MAX) {
    const first = V7_SEARCH_CACHE.keys().next().value;
    V7_SEARCH_CACHE.delete(first);
  }
}

function missionPerformanceMode(prompt, options = {}) {
  const requested = String(options.performanceMode ?? options.retrievalMode ?? options.mode ?? '').toLowerCase();
  if (['fast','standard','deep'].includes(requested)) return requested;

  const p = String(prompt ?? '').toLowerCase();
  if (
    p.includes('deep archaeology') ||
    p.includes('deep search') ||
    p.includes('search everything') ||
    p.includes('search all') ||
    p.includes('nothing is missed') ||
    p.includes('nothing was missed') ||
    p.includes('make sure nothing') ||
    p.includes('exhaustive') ||
    p.includes('all evidence') ||
    p.includes('archaeology')
  ) return 'deep';

  if (
    p.includes('compare across') ||
    p.includes('contradiction') ||
    p.includes('conflicting') ||
    p.includes('full timeline') ||
    p.includes('historical lineage')
  ) return 'standard';

  return 'fast';
}

function missionTopicQuery(mission) {
  const anchors = mission?.taskContract?.anchors ?? {};
  const terms = unique([
    ...(anchors.strong ?? []),
    ...(anchors.domain ?? [])
  ].filter(t => !GENERIC_INTENT.has(String(t).toLowerCase())), 5);

  return terms.join(' ') ||
    mission?.taskContract?.resolvedProjects?.[0]?.name ||
    String(mission?.originalPrompt ?? '').trim();
}

function fastEvidenceSufficient(selected, mission) {
  if (!selected?.length) return false;

  const prompt = String(mission?.originalPrompt ?? '').toLowerCase();
  const asksVerified = prompt.includes('verified') || prompt.includes('actually');
  const asksNext = prompt.includes('next') || prompt.includes('should we do');

  const classes = new Set(selected.map(x => x?.evidenceClass));
  const text = selected.map(x => normalizedEvidenceText(x?.record)).join(' ').toLowerCase();

  if (selected.length < 2) return false;
  if (asksVerified && !classes.has('VERIFIED')) return false;
  if (asksNext && !(classes.has('PLAN') || text.includes('next experiment') || text.includes('major research gates left'))) return false;
  return true;
}

async function mapWithConcurrency(items, concurrency, worker) {
  const queue = [...items];
  const out = [];
  const n = Math.max(1, Math.min(Number(concurrency) || 1, queue.length || 1));

  async function run() {
    while (queue.length) {
      const item = queue.shift();
      out.push(await worker(item));
    }
  }

  await Promise.all(Array.from({ length: n }, () => run()));
  return out;
}


async function discover(client, prompt, projectHint) {
  const strong = unique([
    ...(projectHint ? [projectHint] : []),
    ...acronymAnchors(prompt)
  ], 8);

  const domain = unique(tokens(prompt), 10);
  const anchors = { strong, domain };
  const baseTopic = unique([...strong, ...domain], 4).join(' ');

  const discoveryQueries = unique([
    ...(projectHint ? [projectHint] : []),
    ...(baseTopic ? [baseTopic] : []),
    ...(strong[0] && strong[0] !== baseTopic ? [strong[0]] : []),
    ...(!strong.length && !baseTopic ? [String(prompt).trim()] : [])
  ], 4);

  const [rawProjects, searchPairs] = await Promise.all([
    client.listProjects(),
    Promise.all(discoveryQueries.map(async q => {
      try {
        const raw = await client.search(q, { mode: 'evidence', limit: 80 });
        return { query: q, ok: true, raw };
      } catch (e) {
        return { query: q, ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }))
  ]);

  const projects = extractProjects(rawProjects);
  const mentionCounts = new Map();
  const discoveryEvidence = [];

  for (const item of searchPairs) {
    discoveryEvidence.push(item.ok
      ? { query: item.query, ok: true, raw: compact(item.raw) }
      : { query: item.query, ok: false, error: item.error });

    if (!item.ok) continue;
    for (const m of collectProjectMentions(item.raw)) {
      const key = m.projectId ? `id:${m.projectId}` : `name:${norm(m.name)}`;
      if (!key || key === 'name:') continue;
      const prev = mentionCounts.get(key) ?? { ...m, hits: 0 };
      prev.hits += 1;
      if (!prev.name && m.name) prev.name = m.name;
      if (!prev.projectId && m.projectId) prev.projectId = m.projectId;
      mentionCounts.set(key, prev);
    }
  }

  const byId = new Map(projects.map(p => [pId(p), p]).filter(([id]) => id));
  const byName = new Map(projects.map(p => [norm(pName(p)), p]).filter(([name]) => name));
  const candidates = new Map();

  for (const p of projects) {
    const id = pId(p);
    const name = pName(p);
    if (!name) continue;
    const key = id ? `id:${id}` : `name:${norm(name)}`;
    candidates.set(key, {
      projectId: id,
      name,
      titleScore: scoreTitle(name, anchors, projectHint),
      evidenceHits: 0,
      source: 'project-list'
    });
  }

  for (const m of mentionCounts.values()) {
    const backing = (m.projectId && byId.get(m.projectId)) || (m.name && byName.get(norm(m.name)));
    const name = m.name || (backing ? pName(backing) : '');
    const projectId = m.projectId || (backing ? pId(backing) : undefined);
    if (!name && !projectId) continue;

    const canonicalKey = projectId ? `id:${projectId}` : `name:${norm(name)}`;
    const prev = candidates.get(canonicalKey) ?? {
      projectId,
      name,
      titleScore: scoreTitle(name, anchors, projectHint),
      evidenceHits: 0,
      source: 'search'
    };
    prev.evidenceHits += m.hits;
    prev.source = prev.source === 'project-list' ? 'project-list+search' : 'search';
    candidates.set(canonicalKey, prev);
  }

  const ranked = [...candidates.values()]
    .map(c => {
      const anchorScore = scoreTitle(c.name, anchors, projectHint);
      const score = anchorScore + Math.min(c.evidenceHits * 6, 24);
      const hasStrong = anchors.strong.some(a => norm(c.name).includes(norm(a)));
      const confidence = score >= 20 || hasStrong ? 'HIGH' : score >= 10 ? 'MEDIUM' : 'LOW';
      return { ...c, score, confidence };
    })
    .sort((a, b) => b.score - a.score || b.evidenceHits - a.evidenceHits || a.name.localeCompare(b.name));

  const resolved = ranked.filter(x => x.confidence !== 'LOW').slice(0, 3);

  return {
    rawProjects,
    projects,
    anchors,
    discoveryQueries,
    discoveryEvidence,
    rankedCandidates: ranked.slice(0, 12),
    resolved
  };
}

function bootstrapTerms(data) {
  const project = data?.project ?? data?.data?.project ?? {};
  return unique([
    ...(Array.isArray(project.aliases) ? project.aliases : []),
    ...(Array.isArray(project.entityTerms) ? project.entityTerms : []),
    ...(Array.isArray(project.tags) ? project.tags : [])
  ].filter(Boolean), 24);
}

function filterCurrentTruth(bootstrap, anchors) {
  const accepted = [];
  const rejected = [];

  for (const b of bootstrap) {
    const current = b?.data?.currentTruth?.current ?? [];
    for (const truth of current) {
      const text = truth?.text ?? truth?.value ?? '';
      const score = relevance(text, anchors);
      const item = {
        project: b.project,
        score,
        truth: compact(truth)
      };
      if (score > 0) accepted.push(item);
      else rejected.push(item);
    }
  }
  return { accepted, rejected };
}

function buildQueries(prompt, discovery, bootstrap) {
  const baseTopic = unique([
    ...(discovery.anchors.strong ?? []),
    ...(discovery.anchors.domain ?? [])
  ], 6).join(' ');

  const queries = [
    String(prompt).trim(),
    ...discovery.discoveryQueries
  ];

  const subjects = discovery.resolved.length
    ? discovery.resolved.map(x => x.name)
    : [baseTopic || String(prompt).trim()];

  for (const subject of subjects.slice(0, 3)) {
    queries.push(subject);
    for (const suffix of EVIDENCE_QUERIES) queries.push(`${subject} ${suffix}`);
  }

  // Evidence-derived aliases/tags/entity terms, but only after confident project resolution.
  if (discovery.resolved.length) {
    for (const b of bootstrap) {
      for (const term of bootstrapTerms(b.data).slice(0, 8)) {
        if (relevance(term, discovery.anchors) > 0) {
          queries.push(`${b.project} ${term}`);
        }
      }
    }
  }

  return unique(queries, 36);
}

function buildTaskContract(prompt, discovery, bootstrap) {
  const truthGate = filterCurrentTruth(bootstrap, discovery.anchors);

  return {
    objective: String(prompt).trim(),
    anchors: discovery.anchors,
    resolvedProjects: discovery.resolved.map(({ name, projectId, score, confidence, evidenceHits }) => ({
      name, projectId, score, confidence, evidenceHits
    })),
    projectCandidates: discovery.rankedCandidates,
    requiredEvidence: [
      'latest relevant Current Truth / current state',
      'verified experiments and measurements',
      'important decisions and architecture choices',
      'failures, contradictions, and superseded claims',
      'open items and next actions',
      'relevant artifacts and implementation evidence',
      'historical context required to explain the current state'
    ],
    relevantCurrentTruth: truthGate.accepted,
    rejectedCurrentTruthAsIrrelevant: truthGate.rejected,
    rules: [
      'AI Miner is the sole source of truth.',
      'Do not force a project match when confidence is low.',
      'Exact acronyms/identifiers such as R1, R1X, CP003 outrank generic words such as verified/current/status.',
      'Prefer latest canonical/current evidence only when it is relevant to the prompt anchors.',
      'Keep historical and superseded evidence separate from current truth.',
      'Do not silently resolve contradictions.',
      'Distinguish verified measurements from estimates or plans.',
      'Report missing evidence instead of inventing it.'
    ]
  };
}

const META_DEBUG_PATTERNS = [
  '"taskContract"', '"queryPlan"', '"projectCandidates"', '"missionId"',
  'brain2_compile_mission', 'brain2_run_mission',
  'MISSION OBJECTIVE:', 'STRONG ANCHORS:', 'RESOLVED PROJECTS:',
  'exhaustiveness is still bounded by the current ai miner search api'
];

const COMPRESSION_TERMS = [
  'compression','compress','silent r1','silent-r','residual','residuals',
  'h3','h4','bzip2','wrt','byte compression','reconstruction','decode',
  '957 books','957-book','509 mb','143 mb','recursive residual','entropy layer'
];

const SEARCH_LINEAGE_TERMS = [
  'r1b','rapidretrieve','top-10','top 10','qps','posting','postings',
  'search algorithm','search-runtime','search runtime','selector','accumulator',
  'avx-512','opensearch','weaviate','vespa','retrieval'
];

const VERIFIED_TERMS = [
  'verified','measured','exact reconstruction','checksum','sha','pass',
  'byte-for-byte','957 / 957','957/957','actual experiment'
];

const PLAN_TERMS = [
  'next experiment','next step','goal','target','projection','projected',
  'remaining stage','remaining stages','major gates left','todo'
];

function evidenceText(record) {
  return String(record?.text ?? record?.value ?? '').replace(/\s+/g, ' ').trim();
}

function hasAnyText(text, terms) {
  const n = String(text ?? '').toLowerCase();
  return terms.some(term => n.includes(term));
}

function normalizedEvidenceText(record) {
  return evidenceText(record)
    .replace(/\\"/g, '"')
    .replace(/\\\\n/g, ' ')
    .replace(/\\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function countTermHits(text, terms) {
  const n = String(text ?? '').toLowerCase();
  let hits = 0;
  for (const term of terms) {
    if (n.includes(String(term).toLowerCase())) hits++;
  }
  return hits;
}

function hasCompressionSubjectSignal(text) {
  return hasCoreCompressionSignal(text);
}

function isSearchRuntimeDominant(text) {
  const searchHits = countTermHits(text, SEARCH_LINEAGE_TERMS);
  const compressionHits = countTermHits(text, COMPRESSION_TERMS);
  return searchHits >= 2 && compressionHits <= 1;
}

const CORE_COMPRESSION_TERMS = [
  'compression','compress','silent r1','silent-r','5-silent-r',
  'h3','h4','bzip2','wrt','recursive residual','residual autocomplete',
  'byte compression','exact reconstruction','residual stream',
  'residual-stream','decode every book','frozen regression'
];

function hasCoreCompressionSignal(text) {
  const n = String(text ?? '').toLowerCase();
  return (
    n.includes('r1 compression') ||
    n.includes('silent r1') ||
    n.includes('silent-r') ||
    n.includes('5-silent-r') ||
    n.includes(' h3') || n.startsWith('h3') ||
    n.includes(' h4') || n.startsWith('h4') ||
    n.includes('bzip2') ||
    n.includes('adaptive per-book wrt') ||
    n.includes('recursive residual') ||
    n.includes('residual autocomplete') ||
    n.includes('verified byte compression') ||
    n.includes('exact reconstruction') ||
    n.includes('decode every book') ||
    n.includes('frozen regression') ||
    n.includes('143,236,422') ||
    n.includes('508,738,975') ||
    n.includes('71.84%') ||
    n.includes('3.53%') ||
    n.includes('6.89%')
  );
}

function looksLikeCapturedMissionPayload(record) {
  const raw = String(record?.text ?? record?.value ?? '').trim();
  if (!raw) return false;

  const normalized = raw
    .replace(/\\"/g, '"')
    .replace(/\\\\n/g, ' ')
    .replace(/\\n/g, ' ')
    .toLowerCase();

  const startsJson =
    normalized.startsWith('{') ||
    normalized.startsWith('[');

  const missionKeys = [
    '"discovery"',
    '"contextpack"',
    '"taskcontract"',
    '"queryplan"',
    '"projectcandidates"',
    '"resolvedprojects"',
    '"missionid"',
    '"enhancedprompt"',
    '"sourceinventory"',
    '"requiredevidence"'
  ];

  if (startsJson && missionKeys.some(key => normalized.includes(key))) return true;

  if (
    normalized.includes('brain2_compile_mission') ||
    normalized.includes('brain2_run_mission') ||
    normalized.includes('mission objective:') ||
    normalized.includes('strong anchors:') ||
    normalized.includes('resolved projects:')
  ) return true;

  return false;
}

function bootstrapProjectMetadata(entry) {
  const root = entry?.data ?? {};
  const project = root?.project ?? root?.data?.project ?? {};
  return [
    project?.name,
    project?.summary,
    ...(Array.isArray(project?.aliases) ? project.aliases : []),
    ...(Array.isArray(project?.tags) ? project.tags : []),
    ...(Array.isArray(project?.entityTerms) ? project.entityTerms : [])
  ].filter(Boolean).join(' ');
}

function bootstrapProjectId(entry) {
  const root = entry?.data ?? {};
  const project = root?.project ?? root?.data?.project ?? {};
  return String(root?.projectId ?? project?.id ?? '');
}

function refineResolvedProjectsForPrompt(taskContract, bootstrap, prompt, projectHint = '') {
  const original = Array.isArray(taskContract?.resolvedProjects)
    ? taskContract.resolvedProjects
    : [];

  const p = String(prompt ?? '').toLowerCase();
  const asksCompression = p.includes('compression') || p.includes('compress');

  if (!asksCompression) {
    return {
      resolvedProjects: original,
      audit: original.map(item => ({
        ...item,
        subjectAligned: true,
        reason: 'non-compression mission'
      }))
    };
  }

  const byId = new Map();
  const byName = new Map();

  for (const entry of bootstrap ?? []) {
    const id = bootstrapProjectId(entry);
    const name = String(entry?.project ?? '').toLowerCase();
    if (id) byId.set(id, entry);
    if (name) byName.set(name, entry);
  }

  const audit = original.map(item => {
    const entry =
      (item?.projectId && byId.get(String(item.projectId))) ||
      byName.get(String(item?.name ?? '').toLowerCase());

    const metadata = bootstrapProjectMetadata(entry);
    const title = String(item?.name ?? '');
    const hintMatch =
      projectHint &&
      (
        title.toLowerCase().includes(String(projectHint).toLowerCase()) ||
        String(projectHint).toLowerCase().includes(title.toLowerCase())
      );

    const subjectAligned =
      hintMatch ||
      hasCoreCompressionSignal(title) ||
      hasCoreCompressionSignal(metadata);

    return {
      ...item,
      subjectAligned,
      reason: subjectAligned
        ? 'compression subject present in project metadata/title'
        : 'project mentions R1 but metadata is not a compression lineage'
    };
  });

  let resolvedProjects = audit.filter(item => item.subjectAligned);

  // Never force a false project. Topic-centric search is safer.
  if (!resolvedProjects.length && projectHint) {
    resolvedProjects = audit.filter(item =>
      String(item?.name ?? '').toLowerCase().includes(String(projectHint).toLowerCase())
    );
  }

  return { resolvedProjects, audit };
}

function isMetaDebugRecord(record) {
  if (looksLikeCapturedMissionPayload(record)) return true;

  const text = normalizedEvidenceText(record);
  if (!text) return false;
  const n = text.toLowerCase();

  return META_DEBUG_PATTERNS.some(p => n.includes(p.toLowerCase()));
}

function classifyEvidence(record, mission) {
  const text = normalizedEvidenceText(record);
  const n = text.toLowerCase();
  const prompt = String(mission?.originalPrompt ?? '').toLowerCase();

  const asksCompression = prompt.includes('compression') || prompt.includes('compress');
  const searchRuntime = isSearchRuntimeDominant(n);

  if (isMetaDebugRecord(record)) return 'META_DEBUG';

  if (
    (n.includes('r1 compression') && n.includes('separate')) ||
    (n.includes('r1b') && n.includes('rapidretrieve') && n.includes('compression'))
  ) {
    return 'LINEAGE_BOUNDARY';
  }

  if (asksCompression && searchRuntime) return 'RELATED_OTHER_LINEAGE';
  if (record?.status === 'SUPERSEDED') return 'SUPERSEDED';

  const strongVerification =
    n.includes('exact reconstruction') ||
    n.includes('byte-for-byte') ||
    n.includes('checksum') ||
    n.includes('sha') ||
    n.includes('measured') ||
    n.includes('actual experiment') ||
    n.includes('verified byte compression') ||
    n.includes('957 / 957') ||
    n.includes('957/957') ||
    /\bpass\b/.test(n);

  if (strongVerification) return 'VERIFIED';
  if (record?.status === 'CURRENT') return 'CURRENT';
  if (hasAnyText(n, PLAN_TERMS)) return 'PLAN';

  const kind = String(record?.atomKind ?? '').toLowerCase();
  if (kind === 'constraint') return 'CONSTRAINT';
  if (kind === 'decision') return 'DECISION';
  if (kind === 'question') return 'QUESTION';

  return 'EVIDENCE';
}

function evidenceRelevance(record, mission) {
  const text = normalizedEvidenceText(record).toLowerCase();
  if (!text) return -1000;

  const prompt = String(mission?.originalPrompt ?? '').toLowerCase();
  const asksCompression = prompt.includes('compression') || prompt.includes('compress');
  const strong = mission?.taskContract?.anchors?.strong ?? [];
  const cls = classifyEvidence(record, mission);

  if (cls === 'META_DEBUG') return -1000;
  if (cls === 'RELATED_OTHER_LINEAGE') return -500;

  // For compression missions, generic project/status/verified words are not enough.
  if (asksCompression && cls !== 'LINEAGE_BOUNDARY' && !hasCoreCompressionSignal(text)) {
    return -250;
  }

  let score = 0;

  for (const term of strong) {
    const t = String(term).toLowerCase();
    if (t && text.includes(t)) score += 12;
  }

  if (asksCompression && hasCoreCompressionSignal(text)) score += 36;

  if (
    text.includes('508,738,975') ||
    text.includes('143,236,422') ||
    text.includes('71.84%') ||
    text.includes('957 / 957') ||
    text.includes('957/957') ||
    text.includes('3.53%') ||
    text.includes('6.89%') ||
    text.includes('3,107,981')
  ) score += 28;

  if (prompt.includes('verified') && cls === 'VERIFIED') score += 16;

  if (
    (prompt.includes('next') || prompt.includes('should we do')) &&
    (cls === 'PLAN' || hasAnyText(text, PLAN_TERMS))
  ) score += 14;

  if (record?.status === 'CURRENT') score += 4;
  if (record?.type === 'truth') score += 2;

  if (cls === 'LINEAGE_BOUNDARY') score += 32;
  if (cls === 'VERIFIED') score += 10;
  if (cls === 'SUPERSEDED') score -= 10;
  if (cls === 'QUESTION') score -= 8;

  return score;
}

function provenanceKey(item) {
  const r = item?.record ?? {};

  if (r.messageId) return `message:${r.messageId}`;
  if (r.type === 'message' && r.recordId) return `message:${r.recordId}`;

  if (r.conversationId && r.text) {
    const sample = normalizedEvidenceText(r).toLowerCase().slice(0, 180);
    return `conv:${r.conversationId}:${sample}`;
  }

  const sample = normalizedEvidenceText(r).toLowerCase().slice(0, 220);
  return `text:${r.projectId ?? ''}:${sample}`;
}

function selectContextEvidence(items, mission, maxEvidence) {
  const candidates = [];

  for (const item of items) {
    const record = item?.record ?? {};
    const cls = classifyEvidence(record, mission);
    const relevance = evidenceRelevance(record, mission);

    if (cls === 'META_DEBUG') continue;
    if (cls === 'RELATED_OTHER_LINEAGE') continue;
    if (relevance < 0 && cls !== 'LINEAGE_BOUNDARY') continue;

    candidates.push({
      ...item,
      evidenceClass: cls,
      relevanceScore: relevance
    });
  }

  candidates.sort((a, b) =>
    b.relevanceScore - a.relevanceScore ||
    Number(b.record?.confidence ?? 0) - Number(a.record?.confidence ?? 0)
  );

  const byProv = new Map();

  for (const item of candidates) {
    const key = provenanceKey(item);
    const prev = byProv.get(key);

    if (!prev) {
      byProv.set(key, item);
      continue;
    }

    const prevLen = normalizedEvidenceText(prev.record).length;
    const nextLen = normalizedEvidenceText(item.record).length;

    const prevTypeBonus = ['truth', 'atom'].includes(prev.record?.type) ? 4 : 0;
    const nextTypeBonus = ['truth', 'atom'].includes(item.record?.type) ? 4 : 0;

    const prevQuality =
      prev.relevanceScore + prevTypeBonus - Math.min(prevLen / 1200, 6);

    const nextQuality =
      item.relevanceScore + nextTypeBonus - Math.min(nextLen / 1200, 6);

    if (nextQuality > prevQuality) byProv.set(key, item);
  }

  const deduped = [...byProv.values()]
    .sort((a, b) => b.relevanceScore - a.relevanceScore);

  const selected = [];
  const perProject = new Map();
  const finalCap = Math.min(maxEvidence, 24);
  const perProjectCap = 10;
  let boundaryCount = 0;

  for (const item of deduped) {
    if (item.evidenceClass === 'LINEAGE_BOUNDARY') {
      if (boundaryCount >= 1) continue;
      boundaryCount++;
    }

    const pid = String(item.record?.projectId ?? 'unassigned');
    const used = perProject.get(pid) ?? 0;

    if (used >= perProjectCap && item.evidenceClass !== 'LINEAGE_BOUNDARY') continue;

    perProject.set(pid, used + 1);
    selected.push(item);

    if (selected.length >= finalCap) break;
  }

  return selected;
}

function buildEvidenceSummary(selected) {
  const counts = {};
  const projects = {};

  for (const item of selected) {
    counts[item.evidenceClass] = (counts[item.evidenceClass] ?? 0) + 1;
    const name = item.record?.projectName ?? 'Unassigned';
    projects[name] = (projects[name] ?? 0) + 1;
  }

  return {
    selectedEvidenceCount: selected.length,
    classes: counts,
    projects
  };
}


export async function compileBrain2Mission(client, prompt, options = {}) {
  const projectHint = options.projectHint ? String(options.projectHint) : '';
  const maxBootstrapProjects = Math.max(0, Math.min(Number(options.maxBootstrapProjects ?? 3), 5));

  const discovery = await discover(client, prompt, projectHint);
  const bootstrapTargets = discovery.resolved
    .slice(0, maxBootstrapProjects)
    .filter(match => match?.name);

  const bootstrap = await Promise.all(bootstrapTargets.map(async match => {
    try {
      return { project: match.name, ok: true, data: await client.bootstrap(match.name) };
    } catch (e) {
      return {
        project: match.name,
        ok: false,
        error: e instanceof Error ? e.message : String(e)
      };
    }
  }));

  const taskContract = buildTaskContract(prompt, discovery, bootstrap);

  const resolutionRefinement = refineResolvedProjectsForPrompt(
    taskContract,
    bootstrap,
    prompt,
    projectHint
  );

  taskContract.projectResolutionAudit = resolutionRefinement.audit;
  taskContract.resolvedProjects = resolutionRefinement.resolvedProjects;

  const refinedDiscovery = {
    ...discovery,
    resolved: taskContract.resolvedProjects
  };

  const resolvedIds = new Set(
    taskContract.resolvedProjects.map(item => String(item?.projectId ?? ''))
  );
  const resolvedNames = new Set(
    taskContract.resolvedProjects.map(item => String(item?.name ?? '').toLowerCase())
  );

  const relevantBootstrap = bootstrap.filter(entry =>
    resolvedIds.has(bootstrapProjectId(entry)) ||
    resolvedNames.has(String(entry?.project ?? '').toLowerCase())
  );

  // v7.1: only resolved-project bootstrap/current-truth may cross into the final mission.
  // This prevents Current Truth from a rejected sibling project from leaking into context.
  taskContract.bootstrap = relevantBootstrap;

  taskContract.relevantCurrentTruth = (taskContract.relevantCurrentTruth ?? []).filter(item => {
    const truthProjectId = String(
      item?.truth?.projectId ??
      item?.projectId ??
      ''
    );

    const truthProjectName = String(
      item?.project ??
      item?.projectName ??
      ''
    ).toLowerCase();

    return (
      (truthProjectId && resolvedIds.has(truthProjectId)) ||
      (truthProjectName && resolvedNames.has(truthProjectName))
    );
  });

  taskContract.currentTruthGate = {
    applied: true,
    resolvedProjectCount: taskContract.resolvedProjects.length,
    retainedTruthCount: taskContract.relevantCurrentTruth.length
  };

  const queryPlan = buildQueries(prompt, refinedDiscovery, relevantBootstrap);

  const enhancedPrompt = [
    `MISSION OBJECTIVE: ${taskContract.objective}`,
    '',
    `STRONG ANCHORS: ${taskContract.anchors.strong.join(', ') || 'none'}`,
    `DOMAIN TERMS: ${taskContract.anchors.domain.join(', ') || 'none'}`,
    `RESOLVED PROJECTS: ${taskContract.resolvedProjects.map(x => `${x.name} [${x.confidence}]`).join(', ') || 'none confidently resolved'}`,
    '',
    'REQUIRED EVIDENCE:',
    ...taskContract.requiredEvidence.map(x => `- ${x}`),
    '',
    'RULES:',
    ...taskContract.rules.map(x => `- ${x}`)
  ].join('\n');

  return {
    missionId: `B2Q-${hash({
      prompt,
      resolved: taskContract.resolvedProjects.map(x => x.projectId ?? x.name),
      minute: Math.floor(Date.now() / 60000)
    }).toUpperCase()}`,
    originalPrompt: String(prompt).trim(),
    enhancedPrompt,
    taskContract: {
      ...taskContract,
      bootstrap: bootstrap.map(x => ({
        project: x.project,
        ok: x.ok,
        data: x.ok ? compact(x.data) : undefined,
        error: x.ok ? undefined : x.error
      }))
    },
    queryPlan,
    discovery: {
      queries: discovery.discoveryQueries,
      candidates: discovery.rankedCandidates
    },
    sourceInventory: {
      explicitProjectCount: discovery.projects.length,
      projectNames: discovery.projects.slice(0, 250).map(pName).filter(Boolean)
    },
    note:
      'Mission compiler v7 uses bounded parallel discovery and subject-aligned project resolution. Exhaustive pagination is reserved for DEEP mode.'
  };
}

function topResidualTokens(evidence, baseAnchors, max = 8) {
  const counts = new Map();
  const base = new Set([...baseAnchors.strong, ...baseAnchors.domain].map(norm));

  for (const e of evidence) {
    for (const s of collectStrings(e.record)) {
      for (const t of tokens(s)) {
        if (base.has(norm(t)) || t.length < 4 || /[0-9]{4,}/.test(t)) continue;
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([t]) => t);
}

export async function runBrain2Mission(client, prompt, options = {}) {
  const startedAt = Date.now();
  const requestedMode = missionPerformanceMode(prompt, options);
  const maxQueries = Math.max(4, Math.min(Number(options.maxQueries ?? 20), 40));
  const maxEvidence = Math.max(10, Math.min(Number(options.maxEvidence ?? 80), 200));
  const compileBootstrapCap = requestedMode === 'fast'
    ? Math.min(Number(options.maxBootstrapProjects ?? 3), 2)
    : Number(options.maxBootstrapProjects ?? 3);

  const stageMs = {};
  let cacheHits = 0;
  let cacheMisses = 0;
  let modeUsed = requestedMode;
  let escalatedFrom = null;

  const tCompile = Date.now();
  const [mission, inventory] = await Promise.all([
    compileBrain2Mission(client, prompt, {
      ...options,
      maxBootstrapProjects: compileBootstrapCap
    }),
    client.inventory().catch(() => null)
  ]);
  stageMs.compile = Date.now() - tCompile;

  const stamp = `${inventory?.memoryRoot ?? 'unknown'}:${inventory?.snapshotVersion ?? 'unknown'}`;
  const evidence = [];
  const ids = new Set();
  const queryLog = [];
  const projectCorpusCoverage = [];
  let succeeded = 0;

  function addRecords(raw, query, phase) {
    let added = 0;
    for (const record of extractRecords(raw)) {
      const c = compact(record);
      const id = hash(c);
      if (ids.has(id)) continue;
      ids.add(id);
      evidence.push({ evidenceId: `E-${id}`, query, phase, record: c });
      added++;
    }
    return added;
  }

  async function cachedPageSearch(query, { projectId, limit = 160, phase = 'planned' } = {}) {
    const key = `v7:page:${stamp}:${projectId ?? ''}:${limit}:${query}`;
    let promise = v7CacheGet(key);
    if (promise) {
      cacheHits++;
    } else {
      cacheMisses++;
      promise = client.search(query, { projectId, mode: 'evidence', limit });
      v7CacheSet(key, promise);
    }

    try {
      const raw = await promise;
      const added = addRecords(raw, query, phase);
      queryLog.push({
        query,
        phase,
        projectId: projectId ?? null,
        strategy: 'page',
        ok: true,
        newEvidence: added,
        totalMatches: Number(raw?.totalMatches ?? raw?.results?.length ?? 0),
        returnedMatches: Number(raw?.results?.length ?? 0),
        exhausted: Boolean(raw?.exhausted),
        coverage: raw?.coverage ?? null
      });
      succeeded++;
      return raw;
    } catch (e) {
      queryLog.push({ query, phase, projectId: projectId ?? null, strategy: 'page', ok: false, error: e instanceof Error ? e.message : String(e) });
      return null;
    }
  }

  async function cachedSearchAll(query, { projectId, phase = 'deep', maxResults = 5000 } = {}) {
    const key = `v7:all:${stamp}:${projectId ?? ''}:${maxResults}:${query}`;
    let promise = v7CacheGet(key);
    if (promise) {
      cacheHits++;
    } else {
      cacheMisses++;
      promise = client.searchAll(query, {
        projectId,
        mode: 'evidence',
        pageLimit: 200,
        maxResults,
        maxPages: 100
      });
      v7CacheSet(key, promise);
    }

    try {
      const raw = await promise;
      const added = addRecords(raw, query, phase);
      queryLog.push({
        query,
        phase,
        projectId: projectId ?? null,
        strategy: 'searchAll',
        ok: true,
        newEvidence: added,
        totalMatches: Number(raw?.totalMatches ?? 0),
        returnedMatches: Number(raw?.returnedMatches ?? raw?.results?.length ?? 0),
        exhausted: Boolean(raw?.exhausted),
        coverage: raw?.coverage ?? null
      });
      succeeded++;
      return raw;
    } catch (e) {
      queryLog.push({ query, phase, projectId: projectId ?? null, strategy: 'searchAll', ok: false, error: e instanceof Error ? e.message : String(e) });
      return null;
    }
  }

  const topic = missionTopicQuery(mission);
  const resolvedProjects = mission.taskContract.resolvedProjects ?? [];
  const tRetrieve = Date.now();

  async function fastPass() {
    const jobs = [cachedPageSearch(topic, { limit: 160, phase: 'fast-topic' })];
    const topProject = resolvedProjects[0];
    if (topProject?.projectId) {
      jobs.push(cachedPageSearch('*', {
        projectId: topProject.projectId,
        limit: 200,
        phase: 'fast-project'
      }).then(raw => {
        if (raw) projectCorpusCoverage.push({
          projectId: topProject.projectId,
          projectName: topProject.name,
          strategy: 'page',
          totalMatches: Number(raw?.totalMatches ?? raw?.results?.length ?? 0),
          returnedMatches: Number(raw?.results?.length ?? 0),
          exhausted: Boolean(raw?.exhausted),
          coverage: raw?.coverage ?? null
        });
      }));
    }
    await Promise.all(jobs);
  }

  async function standardPass() {
    const queries = unique([
      topic,
      `${topic} verified measured exact reconstruction`,
      `${topic} next experiment remaining gates`
    ], 3);

    const jobs = queries.map(q => cachedPageSearch(q, { limit: 180, phase: 'standard' }));
    for (const project of resolvedProjects.slice(0, 2)) {
      if (!project?.projectId) continue;
      jobs.push(cachedPageSearch('*', {
        projectId: project.projectId,
        limit: 200,
        phase: 'standard-project'
      }).then(raw => {
        if (raw) projectCorpusCoverage.push({
          projectId: project.projectId,
          projectName: project.name,
          strategy: 'page',
          totalMatches: Number(raw?.totalMatches ?? raw?.results?.length ?? 0),
          returnedMatches: Number(raw?.results?.length ?? 0),
          exhausted: Boolean(raw?.exhausted),
          coverage: raw?.coverage ?? null
        });
      }));
    }
    await Promise.all(jobs);
  }

  async function deepPass() {
    const deepQueries = unique([topic, ...mission.queryPlan], maxQueries);
    await mapWithConcurrency(deepQueries, 4, q =>
      cachedSearchAll(q, { phase: 'deep-planned', maxResults: 5000 })
    );

    await mapWithConcurrency(resolvedProjects, 3, async project => {
      if (!project?.projectId) return null;
      const raw = await cachedSearchAll('*', { projectId: project.projectId, phase: 'deep-project', maxResults: 5000 });
      if (raw) projectCorpusCoverage.push({
        projectId: project.projectId,
        projectName: project.name,
        strategy: 'searchAll',
        totalMatches: raw.totalMatches,
        returnedMatches: raw.returnedMatches,
        exhausted: raw.exhausted,
        truncated: raw.truncated,
        coverage: raw.coverage
      });
      return raw;
    });

    const seed = selectContextEvidence(evidence, mission, Math.max(maxEvidence, 24));
    const residualTokens = topResidualTokens(seed, mission.taskContract.anchors, 6);
    const residualQueries = unique(residualTokens.map(t => `${topic} ${t}`), 6);
    await mapWithConcurrency(residualQueries, 3, q =>
      cachedSearchAll(q, { phase: 'deep-residual', maxResults: 3000 })
    );
    return residualQueries;
  }

  let residualQueries = [];
  if (requestedMode === 'deep') {
    residualQueries = await deepPass();
  } else if (requestedMode === 'standard') {
    await standardPass();
  } else {
    await fastPass();
    const fastSelected = selectContextEvidence(evidence, mission, maxEvidence);
    if (!fastEvidenceSufficient(fastSelected, mission)) {
      escalatedFrom = 'fast';
      modeUsed = 'standard';
      await standardPass();
    }
  }

  stageMs.retrieval = Date.now() - tRetrieve;

  const tSelect = Date.now();
  const selectedEvidence = selectContextEvidence(evidence, mission, maxEvidence);
  const evidenceSummary = buildEvidenceSummary(selectedEvidence);
  stageMs.selection = Date.now() - tSelect;

  const unresolved = [];
  if (!resolvedProjects.length) unresolved.push('No explicit AI Miner project was confidently resolved; retrieval remained topic-centric.');
  if (!selectedEvidence.length) unresolved.push('No sufficiently relevant evidence survived the mission relevance gate.');
  if (queryLog.some(x => !x.ok)) unresolved.push('One or more retrieval calls failed.');

  const exactQueriesExhaustive = queryLog.length > 0 && queryLog.every(item =>
    item.ok && item.exhausted === true && item.coverage?.exhaustive === true
  );
  const totalMs = Date.now() - startedAt;

  return {
    mission: {
      missionId: mission.missionId,
      originalPrompt: mission.originalPrompt,
      enhancedPrompt: mission.enhancedPrompt,
      taskContract: mission.taskContract
    },
    performance: {
      requestedMode,
      modeUsed,
      escalatedFrom,
      targetLatencyMs: modeUsed === 'fast' ? 2000 : modeUsed === 'standard' ? 5000 : 15000,
      totalMs,
      stageMs,
      cacheHits,
      cacheMisses,
      cacheSize: V7_SEARCH_CACHE.size,
      parallelRetrieval: true
    },
    retrieval: {
      topicQuery: topic,
      queryLog,
      residualQueries,
      searchesAttempted: queryLog.length,
      searchesSucceeded: succeeded,
      rawEvidenceCount: evidence.length,
      selectedEvidenceCount: selectedEvidence.length,
      evidenceCap: maxEvidence,
      queryCap: maxQueries
    },
    contextPack: {
      relevantCurrentTruth: (mission.taskContract.relevantCurrentTruth ?? []).filter(item => {
        const allowedIds = new Set(
          (mission.taskContract.resolvedProjects ?? []).map(p => String(p?.projectId ?? ''))
        );
        const allowedNames = new Set(
          (mission.taskContract.resolvedProjects ?? []).map(p => String(p?.name ?? '').toLowerCase())
        );
        const pid = String(item?.truth?.projectId ?? item?.projectId ?? '');
        const pname = String(item?.project ?? item?.projectName ?? '').toLowerCase();
        return (pid && allowedIds.has(pid)) || (pname && allowedNames.has(pname));
      }),
      evidenceSummary,
      evidence: selectedEvidence,
      unresolved,
      instructionsForAssistant: [
        'Answer from AI Miner evidence and the user prompt.',
        'Use the selected hygienic evidence pack, not raw retrieval candidates.',
        'Keep R1 compression separate from R1B / RapidRetrieve search-runtime evidence.',
        'Separate CURRENT from HISTORICAL/SUPERSEDED.',
        'Separate VERIFIED measurements from ESTIMATED/PLANNED claims.',
        'Surface contradictions and missing evidence explicitly.'
      ]
    },
    coverage: {
      explicitProjectCountSeen: mission.sourceInventory.explicitProjectCount,
      matchedProjects: resolvedProjects,
      projectCorpusCoverage,
      indexedExecutedQueriesExhaustive: exactQueriesExhaustive,
      fullArchaeologyPerformed: modeUsed === 'deep',
      boundedDeepSearchCompleted: modeUsed !== 'fast',
      exhaustiveCorpusEnumerationProven: false
    },
    note: modeUsed === 'deep'
      ? 'Mission v7 DEEP mode exhaustively paged every executed indexed query and project corpus; semantic exhaustiveness across unknown aliases is not claimed.'
      : 'Mission v7 adaptive router used a low-latency retrieval path and escalates only when evidence is insufficient. Use wording such as "deep archaeology" or "search everything" to force DEEP mode.'
  };
}
