import crypto from 'node:crypto';

function now() { return Date.now(); }

export class BrowserBridgeError extends Error {
  constructor(message, code = 'BROWSER_BRIDGE_ERROR') {
    super(message);
    this.name = 'BrowserBridgeError';
    this.code = code;
  }
}

export class BrowserBridgeHub {
  constructor(options = {}) {
    this.sessionTtlMs = Number(options.sessionTtlMs ?? process.env.BRAIN2_BRIDGE_SESSION_TTL_MS ?? 45_000);
    this.requestTimeoutMs = Number(options.requestTimeoutMs ?? process.env.BRAIN2_BRIDGE_REQUEST_TIMEOUT_MS ?? 20_000);
    this.longPollMs = Number(options.longPollMs ?? process.env.BRAIN2_BRIDGE_LONG_POLL_MS ?? 20_000);
    this.sessions = new Map();
    this.pending = new Map();
  }

  touch(meta) {
    const id = String(meta?.sessionId ?? '');
    if (!id) throw new BrowserBridgeError('Missing browser bridge sessionId', 'BAD_SESSION');
    const prior = this.sessions.get(id) ?? { queue: [], waiter: null };
    const session = { ...prior, ...meta, sessionId: id, lastSeenAt: now(), queue: prior.queue ?? [], waiter: prior.waiter ?? null };
    this.sessions.set(id, session);
    return session;
  }

  activeSessions() {
    const cutoff = now() - this.sessionTtlMs;
    return [...this.sessions.values()]
      .filter(s => s.lastSeenAt >= cutoff)
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt || a.sessionId.localeCompare(b.sessionId));
  }

  chooseSession(memoryRoot = '') {
    const active = this.activeSessions();
    const selected = memoryRoot ? active.find(s => String(s.memoryRoot ?? '') === String(memoryRoot)) : active[0];
    if (!selected) throw new BrowserBridgeError('No active AI Miner browser bridge session. Keep the AI Miner tab open.', 'NO_ACTIVE_BROWSER');
    return selected;
  }

  async poll(meta) {
    const session = this.touch(meta);
    if (session.queue.length) return session.queue.shift();
    if (session.waiter) {
      try { session.waiter.resolve(null); } catch {}
      clearTimeout(session.waiter.timer);
      session.waiter = null;
    }
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        if (session.waiter?.resolve === resolve) session.waiter = null;
        resolve(null);
      }, this.longPollMs);
      session.waiter = { resolve, timer };
    });
  }

  request(method, params = {}, options = {}) {
    const session = this.chooseSession(options.memoryRoot ?? '');
    const requestId = `b2br_${crypto.randomUUID()}`;
    const command = { requestId, method, params };
    return new Promise((resolve, reject) => {
      const timeoutMs = Number(options.timeoutMs ?? this.requestTimeoutMs);
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new BrowserBridgeError(`Browser bridge request timed out: ${method}`, 'REQUEST_TIMEOUT'));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer, sessionId: session.sessionId, method });
      if (session.waiter) {
        const waiter = session.waiter;
        session.waiter = null;
        clearTimeout(waiter.timer);
        waiter.resolve(command);
      } else {
        session.queue.push(command);
      }
    });
  }

  respond(payload) {
    const requestId = String(payload?.requestId ?? '');
    const entry = this.pending.get(requestId);
    if (!entry) return { accepted: false, reason: 'UNKNOWN_OR_EXPIRED_REQUEST' };
    if (String(payload?.sessionId ?? '') !== entry.sessionId) return { accepted: false, reason: 'SESSION_MISMATCH' };
    clearTimeout(entry.timer);
    this.pending.delete(requestId);
    if (payload?.ok) entry.resolve(payload.result);
    else entry.reject(new BrowserBridgeError(String(payload?.error ?? `Bridge method failed: ${entry.method}`), 'REMOTE_METHOD_ERROR'));
    return { accepted: true };
  }

  status() {
    return {
      ok: this.activeSessions().length > 0,
      activeSessions: this.activeSessions().map(s => ({
        sessionId: s.sessionId,
        deviceId: s.deviceId,
        memoryRoot: s.memoryRoot,
        snapshotVersion: s.snapshotVersion,
        websiteOrigin: s.websiteOrigin,
        appVersion: s.appVersion,
        lastSeenAt: new Date(s.lastSeenAt).toISOString(),
        queuedCommands: s.queue.length,
      })),
      pendingRequests: this.pending.size,
    };
  }
}
