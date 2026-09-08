import { truncate } from './utils.mjs';

export class AiMinerError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'AiMinerError';
    Object.assign(this, details);
  }
}

export class AiMinerClient {
  constructor(options = {}) {
    if (!options.bridgeHub) throw new Error('AiMinerClient requires bridgeHub');
    this.bridge = options.bridgeHub;
    this.baseUrl = 'browser-indexeddb://brain2-ai-miner';
  }

  async health() { return this.bridge.request('health'); }

  async listProjects() {
    const raw = await this.bridge.request('listProjects');
    return { raw, projects: Array.isArray(raw?.projects) ? raw.projects : [] };
  }

  projectId(project) { return String(project?.id ?? project?.projectId ?? project?.project_id ?? project?.slug ?? project?.name ?? ''); }
  projectName(project) { return String(project?.name ?? project?.title ?? project?.label ?? this.projectId(project)); }

  async resolveProject(projectRef) {
    const project = await this.bridge.request('getProject', { project: projectRef });
    if (!project) throw new AiMinerError(`Project not found in AI Miner: ${projectRef}`);
    return project;
  }

  async getProject(projectRef) { return this.resolveProject(projectRef); }

  async search(query, { projectId, mode = 'evidence', limit = 100, cursor, kinds } = {}) {
    const raw = await this.bridge.request('search', { query, projectId, mode, limit, cursor, kinds });
    return {
      raw,
      query: raw?.query ?? query,
      results: Array.isArray(raw?.results) ? raw.results : [],
      totalMatches: Number(raw?.totalMatches ?? raw?.results?.length ?? 0),
      nextCursor: raw?.nextCursor ?? null,
      exhausted: Boolean(raw?.exhausted ?? true),
      coverage: raw?.coverage ?? null,
      snapshotVersion: raw?.snapshotVersion,
      memoryRoot: raw?.memoryRoot,
    };
  }

  async searchAll(query, {
    projectId,
    mode = 'evidence',
    pageLimit = 200,
    maxResults = 5000,
    maxPages = 100,
    kinds
  } = {}) {
    const results = [];
    let cursor;
    let totalMatches = 0;
    let pages = 0;
    let exhausted = false;
    let coverage = null;
    let snapshotVersion;
    let memoryRoot;

    do {
      const page = await this.search(query, {
        projectId,
        mode,
        limit: Math.max(1, Math.min(200, Number(pageLimit))),
        cursor,
        kinds,
      });

      pages += 1;
      totalMatches = page.totalMatches;
      coverage = page.coverage;
      snapshotVersion = page.snapshotVersion;
      memoryRoot = page.memoryRoot;

      for (const item of page.results) {
        results.push(item);
        if (results.length >= maxResults) break;
      }

      exhausted = page.exhausted;
      cursor = page.nextCursor ?? undefined;

      if (results.length >= maxResults) break;
      if (!cursor) break;
    } while (!exhausted && pages < maxPages);

    return {
      query,
      projectId,
      results,
      totalMatches,
      returnedMatches: results.length,
      pages,
      exhausted: exhausted && !cursor,
      truncated: results.length < totalMatches,
      nextCursor: cursor ?? null,
      coverage: {
        ...(coverage ?? {}),
        allReturnedMatchesRead: results.length >= totalMatches,
        exhaustive: Boolean(
          exhausted &&
          results.length >= totalMatches &&
          coverage?.searchIndexComplete
        ),
      },
      snapshotVersion,
      memoryRoot,
    };
  }

  async inventory() {
    return this.bridge.request('inventory');
  }

  async syncProof() {
    return this.bridge.request('syncProof');
  }


  async currentTruth(projectId) {
    return this.bridge.request('currentTruth', { projectId });
  }

  async sources(projectId) {
    const raw = await this.bridge.request('sources', { projectId });
    return { raw, sources: Array.isArray(raw?.sources) ? raw.sources : [] };
  }

  async sourceById(sourceId) {
    return this.bridge.request('getSource', { sourceId });
  }

  async bootstrap(projectRef) {
    const raw = await this.bridge.request('bootstrap', { project: projectRef });
    if (!raw?.projectId) throw new AiMinerError(`Invalid bootstrap response for project: ${projectRef}`, { body: truncate(raw, 2000) });
    return raw;
  }

  async createCanonicalMission(input) {
    return this.bridge.request('createMission', input);
  }

  async checkpointCanonicalMission(input) {
    return this.bridge.request('checkpointMission', input);
  }

  async addCanonicalVerification(input) {
    return this.bridge.request('addVerification', input);
  }

  async probe() {
    const report = { transport: this.baseUrl, checks: [] };
    for (const [name, fn] of [
      ['browser_bridge', () => Promise.resolve(this.bridge.status())],
      ['health', () => this.health()],
      ['projects', () => this.listProjects()],
      ['search', () => this.search('Brain2')]
    ]) {
      try {
        const value = await fn();
        report.checks.push({ name, ok: true, sample: truncate(value, 1000) });
      } catch (err) {
        report.checks.push({ name, ok: false, error: err.message });
      }
    }
    report.ok = report.checks.every(x => x.ok);
    return report;
  }
}
