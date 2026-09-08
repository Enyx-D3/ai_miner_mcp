import assert from 'node:assert/strict';
import test from 'node:test';
import { AiMinerClient } from '../src/ai-miner-client.mjs';

class FakeHub {
  constructor() { this.calls = []; }
  status() { return { ok: true, activeSessions: [{ sessionId: 's1' }] }; }
  async request(method, params) {
    this.calls.push({ method, params });
    if (method === 'listProjects') return { projects: [{ id: 'p1', name: 'Alpha' }] };
    if (method === 'getProject') return { id: 'p1', name: 'Alpha' };
    if (method === 'search') return { results: [{ id: 'm1', text: 'RapidRetrieve' }] };
    if (method === 'bootstrap') return { project: { id: 'p1', name: 'Alpha' }, projectId: 'p1', projectName: 'Alpha', currentTruth: { current: [] }, sources: [] };
    if (method === 'health') return { ok: true };
    return {};
  }
}

test('AiMinerClient reads through browser bridge transport', async () => {
  const hub = new FakeHub();
  const client = new AiMinerClient({ bridgeHub: hub });
  const projects = await client.listProjects();
  assert.equal(projects.projects[0].name, 'Alpha');
  const search = await client.search('RapidRetrieve', { projectId: 'p1', mode: 'evidence' });
  assert.equal(search.results[0].id, 'm1');
  const boot = await client.bootstrap('Alpha');
  assert.equal(boot.projectId, 'p1');
  assert.equal(client.baseUrl, 'browser-indexeddb://brain2-ai-miner');
});
