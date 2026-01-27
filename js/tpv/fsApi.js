class FacturaScriptsApi {
  constructor({ baseUrl, apiKey, token }) {
    this.baseUrl = String(baseUrl || "").replace(/\/$/, "");
    this.apiKey = apiKey || null;   // Token de FacturaScripts
    this.token = token || null;     // si realmente tuvieras Bearer (normalmente NO)
  }

  _headers({ method } = {}) {
    const h = { Accept: "application/json" };

    // Token de FS
    if (this.apiKey) h["Token"] = this.apiKey;

    // Bearer (solo si aplica de verdad)
    if (this.token) h["Authorization"] = `Bearer ${this.token}`;

    // Content-Type solo cuando mandas body JSON
    const m = String(method || "GET").toUpperCase();
    if (m !== "GET") h["Content-Type"] = "application/json";

    return h;
  }

  _normPath(path) {
    const p = String(path || "");
    return p.startsWith("/") ? p : `/${p}`;
  }

  async get(path, query = "") {
    const p = this._normPath(path);
    const url = `${this.baseUrl}${p}${query ? `?${query}` : ""}`;
    const res = await fetch(url, { headers: this._headers({ method: "GET" }) });
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
    return res.json();
  }

  async post(path, body) {
    const p = this._normPath(path);
    const url = `${this.baseUrl}${p}`;
    const res = await fetch(url, {
      method: "POST",
      headers: this._headers({ method: "POST" }),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`POST ${url} -> ${res.status}`);
    return res.json();
  }

  async put(path, body) {
    const p = this._normPath(path);
    const url = `${this.baseUrl}${p}`;
    const res = await fetch(url, {
      method: "PUT",
      headers: this._headers({ method: "PUT" }),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`PUT ${url} -> ${res.status}`);
    return res.json();
  }

  async patch(path, body) {
    const p = this._normPath(path);
    const url = `${this.baseUrl}${p}`;
    const res = await fetch(url, {
      method: "PATCH",
      headers: this._headers({ method: "PATCH" }),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`PATCH ${url} -> ${res.status}`);
    return res.json();
  }
}

module.exports = { FacturaScriptsApi };
