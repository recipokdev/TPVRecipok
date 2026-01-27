class LockClient {
  constructor({ baseUrl, ttlSeconds }) {
    this.baseUrl = baseUrl; // null => local-only
    this.ttlSeconds = ttlSeconds;
    this.sessionId = crypto.randomUUID();
  }

  async acquire({ idtpv, nick }) {
    if (!this.baseUrl) {
      // local-only: no bloquea entre PCs, pero evita dobles pestañas en el mismo equipo si guardas en localStorage
      const key = `tpv_lock_${idtpv}`;
      const raw = localStorage.getItem(key);
      if (raw) {
        const lock = JSON.parse(raw);
        const age = Date.now() - lock.lastSeenMs;
        if (age < this.ttlSeconds * 1000) {
          return { ok: false, lockedBy: lock.nick, sinceMs: lock.sinceMs };
        }
      }
      localStorage.setItem(key, JSON.stringify({ nick, sessionId: this.sessionId, sinceMs: Date.now(), lastSeenMs: Date.now() }));
      return { ok: true };
    }

    const res = await fetch(`${this.baseUrl}/locks/acquire`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idtpv, nick, sessionId: this.sessionId, ttlSeconds: this.ttlSeconds }),
    });
    const data = await res.json();
    return data; // {ok:true} o {ok:false, lockedBy, since}
  }

  async heartbeat({ idtpv }) {
    if (!this.baseUrl) {
      const key = `tpv_lock_${idtpv}`;
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const lock = JSON.parse(raw);
      if (lock.sessionId !== this.sessionId) return;
      lock.lastSeenMs = Date.now();
      localStorage.setItem(key, JSON.stringify(lock));
      return;
    }

    await fetch(`${this.baseUrl}/locks/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idtpv, sessionId: this.sessionId }),
    });
  }

  async release({ idtpv }) {
    if (!this.baseUrl) {
      const key = `tpv_lock_${idtpv}`;
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const lock = JSON.parse(raw);
      if (lock.sessionId === this.sessionId) localStorage.removeItem(key);
      return;
    }

    await fetch(`${this.baseUrl}/locks/release`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idtpv, sessionId: this.sessionId }),
    });
  }
}

module.exports = { LockClient };