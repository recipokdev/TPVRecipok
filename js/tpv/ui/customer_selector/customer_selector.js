(function () {
  const CSX = {
    _cfg: null,
    _customers: [],
    _selected: null, // objeto cliente
    _defaultCod: "1",
    _defaultCustomer: { codcliente: "1", nombre: "Ventas tickets" },
    _onChange: null,
    _debug: false,

    _els: {
      overlay: null,
      search: null,
      body: null,
      foot: null,
    },

    log(...args) {
      if (this._debug) console.log("[CSX]", ...args);
    },

    async _fetchJson(url) {
      const cfg = this._cfg || {};
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
          Token: cfg.apiKey,
        },
      });

      if (res.status === 429) {
        throw new Error(
          "La API ha devuelto 429 (demasiadas peticiones). " +
            "Es un bloqueo temporal por seguridad. Espera unos minutos.",
        );
      }

      let data;
      try {
        data = await res.json();
      } catch (e) {
        throw new Error("Respuesta no válida (no JSON).");
      }

      if (data && data.status === "error") {
        throw new Error(data.message || "Error API");
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText || ""}`);
      }

      return data;
    },

    async _loadCustomers() {
      const baseUrl = String(this._cfg?.baseUrl || "").replace(/\/+$/, "");
      if (!baseUrl) return [];

      // ✅ pide ASC
      const url = `${baseUrl}/clientes?sort[codcliente]=ASC&limit=0`;
      const data = await this._fetchJson(url);

      if (!Array.isArray(data)) return [];
      const list = data.filter((c) => !c?.debaja);

      const normalized = list.map((c) => ({
        codcliente: String(c.codcliente || ""),
        nombre: String(c.nombre || ""),
        razonsocial: String(c.razonsocial || ""),
        cifnif: String(c.cifnif || ""),
        _raw: c,
      }));

      // ✅ orden numérico: 1,2,3...
      normalized.sort((a, b) => Number(a.codcliente) - Number(b.codcliente));

      return normalized;
    },

    _ensureModalDom() {
      if (this._els.overlay) return;

      const overlay = document.createElement("div");
      overlay.className = "csx-overlay";
      overlay.innerHTML = `
        <div class="csx-modal" role="dialog" aria-modal="true">
          <div class="csx-head">
            <div class="csx-title">Seleccionar cliente</div>
            <input class="csx-search" type="text" placeholder="Buscar por nombre, CIF o código..." />
            <button class="csx-close" type="button" title="Cerrar">✕</button>
          </div>
          <div class="csx-body"></div>
          <div class="csx-foot">
            <div class="csx-foot-left"></div>
            <div class="csx-foot-right">Click para seleccionar</div>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      const modal = overlay.querySelector(".csx-modal");
      const search = overlay.querySelector(".csx-search");
      const body = overlay.querySelector(".csx-body");
      const footLeft = overlay.querySelector(".csx-foot-left");
      const btnClose = overlay.querySelector(".csx-close");

      // cerrar al click fuera
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) this.close();
      });

      btnClose.addEventListener("click", () => this.close());

      // evitar que click dentro cierre
      modal.addEventListener("click", (e) => e.stopPropagation());

      // search
      search.addEventListener("input", () => this._renderList(search.value));

      // ESC
      window.addEventListener("keydown", (e) => {
        if (e.key === "Escape") this.close();
      });

      this._els.overlay = overlay;
      this._els.search = search;
      this._els.body = body;
      this._els.foot = footLeft;
    },

    _renderList(term) {
      const body = this._els.body;
      const foot = this._els.foot;
      if (!body) return;

      const t = String(term || "")
        .trim()
        .toLowerCase();

      const selectedCod = String(
        this._selected?.codcliente || this._defaultCod,
      );

      const list = (this._customers || []).filter((c) => {
        if (!t) return true;
        const hay =
          `${c.codcliente} ${c.nombre} ${c.razonsocial} ${c.cifnif}`.toLowerCase();
        return hay.includes(t);
      });

      foot.textContent = `${list.length} clientes`;

      body.innerHTML = list
        .map((c) => {
          const isSel = String(c.codcliente) === selectedCod;
          const sub = [c.razonsocial, c.cifnif].filter(Boolean).join(" · ");
          return `
            <div class="csx-row ${isSel ? "csx-selected" : ""}" data-cod="${c.codcliente}">
              <div class="csx-cod">${c.codcliente}</div>
              <div style="flex:1;">
                <div class="csx-name">${this._escape(c.nombre || "—")}</div>
                ${sub ? `<div class="csx-sub">${this._escape(sub)}</div>` : ""}
              </div>
            </div>
          `;
        })
        .join("");

      // bind click
      body.querySelectorAll(".csx-row").forEach((row) => {
        row.addEventListener("click", () => {
          const cod = row.getAttribute("data-cod") || "";
          if (!cod) return;
          if (cod === selectedCod) return; // ya seleccionado
          const found = (this._customers || []).find(
            (x) => String(x.codcliente) === String(cod),
          );
          if (found) this.setSelected(found);
          this.close();
        });
      });
    },

    _escape(s) {
      return String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    },

    _emitChange() {
      const c = this.getSelectedCustomer();
      if (typeof this._onChange === "function") this._onChange(c);
    },

    getSelectedCustomerCodcliente() {
      return String(this._selected?.codcliente || this._defaultCod || "1");
    },

    getSelectedCustomer() {
      const cod = this.getSelectedCustomerCodcliente();
      const isDefault = cod === String(this._defaultCod);

      if (isDefault) {
        return {
          codcliente: String(this._defaultCod),
          nombre: String(this._defaultCustomer?.nombre || "Ventas tickets"),
          isDefault: true,
        };
      }

      return {
        codcliente: String(this._selected?.codcliente || cod),
        nombre: String(this._selected?.nombre || ""),
        isDefault: false,
      };
    },

    setSelected(customerObj) {
      this._selected = customerObj || null;
      this._emitChange();
    },

    resetToDefault() {
      this._selected = null;
      this._emitChange();
    },

    listCustomers() {
      return (this._customers || [])
        .slice()
        .sort((a, b) => Number(a.codcliente) - Number(b.codcliente));
    },

    setDefaultCodcliente(cod) {
      const nextCod = String(cod || "1");

      this._defaultCod = nextCod;

      // intenta tomar nombre real del cliente como default
      const found = (this._customers || []).find(
        (c) => String(c.codcliente) === nextCod,
      );

      this._defaultCustomer = {
        codcliente: nextCod,
        nombre: found?.nombre ? String(found.nombre) : "Ventas tickets",
      };

      // si NO hay cliente seleccionado (estabas en default), refresca UI
      if (!this._selected) this._emitChange();
    },

    open() {
      this._ensureModalDom();
      this._els.overlay.classList.add("csx-open");
      this._els.search.value = "";
      this._renderList("");
      setTimeout(() => this._els.search.focus(), 0);
    },

    close() {
      if (!this._els.overlay) return;
      this._els.overlay.classList.remove("csx-open");
    },

    async mount({
      baseUrl,
      apiKey,
      defaultCodcliente = "1",
      onChange,
      debug = false,
    }) {
      this._cfg = {
        baseUrl: String(baseUrl || "").replace(/\/+$/, ""),
        apiKey: String(apiKey || "").trim(),
      };
      this._defaultCod = String(defaultCodcliente || "1");
      this._onChange = onChange;
      this._debug = !!debug;

      this._ensureModalDom();

      // carga inicial
      this._customers = await this._loadCustomers().catch((e) => {
        console.warn("[CSX] No pude cargar clientes:", e?.message || e);
        return [];
      });

      // asegurar que exista el default en la lista (no obligatorio, pero ayuda)
      const hasDefault = this._customers.some(
        (c) => String(c.codcliente) === String(this._defaultCod),
      );
      if (!hasDefault) {
        this._customers.push({
          codcliente: String(this._defaultCod),
          nombre: String(this._defaultCustomer?.nombre || "Ventas tickets"),
          razonsocial: "",
          cifnif: "",
          _raw: null,
        });
      }

      // ✅ reordenar por si acabamos de añadir el default
      this._customers.sort(
        (a, b) => Number(a.codcliente) - Number(b.codcliente),
      );

      // pinta estado inicial
      this._emitChange();
    },
  };

  window.CUSTOMER_SELECTOR = CSX;
})();
