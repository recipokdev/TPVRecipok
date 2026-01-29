class FacturaScriptsApi {
  constructor({ baseUrl, apiKey, token }) {
    this.baseUrl = String(baseUrl || "").replace(/\/$/, "");
    this.apiKey = apiKey || null;
    this.token = token || null;
  }

  _headers({ method } = {}) {
    const h = { Accept: "application/json" };

    if (this.apiKey) h["Token"] = this.apiKey;
    if (this.token) h["Authorization"] = `Bearer ${this.token}`;

    const m = String(method || "GET").toUpperCase();
    if (m !== "GET") h["Content-Type"] = "application/x-www-form-urlencoded";

    return h;
  }

  _normPath(path) {
    const p = String(path || "");
    return p.startsWith("/") ? p : `/${p}`;
  }

  _buildBody(fields = {}) {
    const body = new URLSearchParams();
    Object.entries(fields).forEach(([k, v]) => {
      if (v === undefined || v === null) return;
      body.append(k, String(v));
    });
    return body.toString();
  }

  async get(path, query = "") {
    const p = this._normPath(path);
    const url = `${this.baseUrl}${p}${query ? `?${query}` : ""}`;

    const res = await fetch(url, {
      headers: this._headers({ method: "GET" }),
    });

    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch {}

    if (!res.ok || data?.error) {
      throw new Error(data?.error || `GET ${url} -> ${res.status} :: ${text}`);
    }
    return data;
  }

  async _send(method, path, body) {
    const p = this._normPath(path);
    const url = `${this.baseUrl}${p}`;

    const res = await fetch(url, {
      method,
      headers: this._headers({ method }),
      body: this._buildBody(body),
    });

    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch {}

    if (!res.ok || data?.error) {
      throw new Error(data?.error || `${method} ${url} -> ${res.status} :: ${text}`);
    }

    return data;
  }

  post(path, body) {
    return this._send("POST", path, body);
  }

  put(path, body) {
    return this._send("PUT", path, body);
  }

  patch(path, body) {
    return this._send("PATCH", path, body);
  }
}

module.exports = { FacturaScriptsApi };