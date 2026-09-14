(function () {
  const KEYBOARD_LAYOUT = [
    [
      { key: "1", label: "1" },
      { key: "2", label: "2" },
      { key: "3", label: "3" },
      { key: "4", label: "4" },
      { key: "5", label: "5" },
      { key: "6", label: "6" },
      { key: "7", label: "7" },
      { key: "8", label: "8" },
      { key: "9", label: "9" },
      { key: "0", label: "0" },
    ],
    [
      { key: "q", label: "q" },
      { key: "w", label: "w" },
      { key: "e", label: "e" },
      { key: "r", label: "r" },
      { key: "t", label: "t" },
      { key: "y", label: "y" },
      { key: "u", label: "u" },
      { key: "i", label: "i" },
      { key: "o", label: "o" },
      { key: "p", label: "p" },
    ],
    [
      { key: "a", label: "a" },
      { key: "s", label: "s" },
      { key: "d", label: "d" },
      { key: "f", label: "f" },
      { key: "g", label: "g" },
      { key: "h", label: "h" },
      { key: "j", label: "j" },
      { key: "k", label: "k" },
      { key: "l", label: "l" },
      { key: "ñ", label: "ñ" },
    ],
    [
      { key: "z", label: "z" },
      { key: "x", label: "x" },
      { key: "c", label: "c" },
      { key: "v", label: "v" },
      { key: "b", label: "b" },
      { key: "n", label: "n" },
      { key: "m", label: "m" },
      { key: "-", label: "-" },
    ],
    [
      { key: ".", label: "." },
      { key: "_", label: "_" },
      { key: "@", label: "@" },
      { key: "/", label: "/" },
      { key: ",", label: "," },
    ],
  ];

  // Minusculas y sin acentos, asi "jose" encuentra "José" (teclado sin
  // tildes). Copia local a proposito: este selector es un componente aparte
  // y no depende de renderer.js para funcionar.
  var CUSTOMER_SEARCH_DIACRITICS_RE = new RegExp(
    "[" + String.fromCharCode(0x0300) + "-" + String.fromCharCode(0x036f) + "]",
    "g",
  );
  function normalizeCustomerSearchText(str) {
    return String(str || "")
      .normalize("NFD")
      .replace(CUSTOMER_SEARCH_DIACRITICS_RE, "")
      .toLowerCase();
  }

  const CSX = {
    _cfg: null,
    _customers: [],
    // Superset sin filtrar por papelera (pero ya sin los "de baja" de
    // FacturaScripts) -- solo para poder mostrar el nombre real de un
    // cliente oculto dentro de la propia papelera.
    _customersAll: [],
    // Entradas crudas de la papelera del TPV (ver _loadHiddenCustomers):
    // [{codcliente, hiddenAt, hiddenByTerminalId, hiddenByTerminalName}].
    _hiddenEntries: [],
    // Callback opcional fijado en mount() -- este componente no conoce
    // currentTerminal (vive en renderer.js), asi que se lo pide a quien lo
    // monta en vez de duplicar ese estado aqui.
    _getTerminalInfo: null,
    _selected: null,
    _defaultCod: "1",
    _defaultCustomer: { codcliente: "1", nombre: "Ventas tickets" },
    _onChange: null,
    _debug: false,
    _activeInput: null,
    _kbCaps: false,
    _createMode: "create",
    _editingCustomerCod: "",

    _els: {
      overlay: null,
      listModal: null,
      createModal: null,
      trashModal: null,
      trashBody: null,
      trashCount: null,
      trashBtn: null,
      closeTrashBtn: null,
      backListFromTrashBtn: null,
      search: null,
      listBody: null,
      listCount: null,
      listClose: null,
      openCreateBtn: null,
      openSearchKeyboardBtn: null,
      backToListBtn: null,
      createCloseBtns: [],
      createTitle: null,
      createForm: null,
      saveNewBtn: null,
      createError: null,
      keyboard: null,
    },

    log(...args) {
      if (this._debug) console.log("[CSX]", ...args);
    },

    _escape(s) {
      return String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    },

    _normalizeCustomer(c) {
      return {
        codcliente: String(c?.codcliente || ""),
        nombre: String(c?.nombre || c?.razonsocial || ""),
        razonsocial: String(c?.razonsocial || c?.nombre || ""),
        cifnif: String(c?.cifnif || ""),
        _raw: c || null,
      };
    },

    // Config del servidor compartido del TPV (parked_tpv_shared -- el mismo
    // que ya usan aparcados/ledger de stock), NO el de FacturaScripts. Copia
    // local a proposito del mismo mecanismo real de renderer.js
    // (TPV_SYNC_API_URL/getTpvSyncApiKey/getCurrentSlugForReservations) --
    // este componente es autocontenido y no depende de renderer.js.
    _getSyncCfg() {
      const syncApiUrl = String(
        window.TPV_CONFIG?.tpvSyncApiUrl ||
          "https://plus.recipok.com/tpv/api/index.php",
      ).replace(/\/+$/, "");

      const syncApiKey =
        String(window.TPV_CONFIG?.tpvApiKey || "").trim() ||
        String(window.RECIPOK_API?.apiKey || "").trim() ||
        String(localStorage.getItem("tpv_sync_api_key") || "").trim();

      const baseUrl = String(this._cfg?.baseUrl || "");
      const m = baseUrl.match(/plus\.recipok\.com\/([^/]+)\/api\/\d+/i);
      const slug = m ? String(m[1]).trim() : "";

      return { syncApiUrl, syncApiKey, slug };
    },

    async _fetchJson(url) {
      const cfg = this._cfg || {};
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Token: cfg.apiKey,
        },
      });

      if (res.status === 429) {
        throw new Error(
          "La API ha devuelto 429 (demasiadas peticiones). Espera unos minutos.",
        );
      }

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          data?.message ||
            data?.error ||
            `HTTP ${res.status}: ${res.statusText || ""}`,
        );
      }

      if (data && data.status === "error") {
        throw new Error(data.message || "Error API");
      }

      return data;
    },

    async _postForm(resource, payload) {
      const cfg = this._cfg || {};
      const baseUrl = String(cfg.baseUrl || "").replace(/\/+$/, "");
      if (!baseUrl) throw new Error("API no configurada.");

      const body = new URLSearchParams();
      Object.entries(payload || {}).forEach(([key, value]) => {
        if (value === undefined || value === null) return;
        body.append(key, String(value));
      });

      const res = await fetch(`${baseUrl}/${resource}`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          Token: cfg.apiKey,
        },
        body: body.toString(),
      });

      if (res.status === 429) {
        throw new Error(
          "La API ha devuelto 429 (demasiadas peticiones). Espera unos minutos.",
        );
      }

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          data?.message ||
            data?.error ||
            `${res.status} ${res.statusText || ""}`,
        );
      }

      if (data && data.status === "error") {
        throw new Error(data.message || "Error API");
      }

      return data;
    },

    async _updateForm(resource, cod, payload) {
      const cfg = this._cfg || {};
      const baseUrl = String(cfg.baseUrl || "").replace(/\/+$/, "");
      if (!baseUrl) throw new Error("API no configurada.");

      const safeCode = encodeURIComponent(String(cod || "").trim());
      if (!safeCode) throw new Error("Código inválido.");

      const body = new URLSearchParams();
      Object.entries(payload || {}).forEach(([key, value]) => {
        if (value === undefined || value === null) return;
        body.append(key, String(value));
      });

      const send = async (method) => {
        const res = await fetch(`${baseUrl}/${resource}/${safeCode}`, {
          method,
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
            Token: cfg.apiKey,
          },
          body: body.toString(),
        });

        if (res.status === 429) {
          throw new Error(
            "La API ha devuelto 429 (demasiadas peticiones). Espera unos minutos.",
          );
        }

        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(
            data?.message ||
              data?.error ||
              `${res.status} ${res.statusText || ""}`,
          );
        }

        if (data && data.status === "error") {
          throw new Error(data.message || "Error API");
        }

        return data;
      };

      try {
        return await send("PATCH");
      } catch {
        return send("PUT");
      }
    },

    async _deleteCustomerByCode(codcliente) {
      const cfg = this._cfg || {};
      const baseUrl = String(cfg.baseUrl || "").replace(/\/+$/, "");
      if (!baseUrl) throw new Error("API no configurada.");

      const safeCode = encodeURIComponent(String(codcliente || "").trim());
      if (!safeCode) throw new Error("Código de cliente inválido.");

      const res = await fetch(`${baseUrl}/clientes/${safeCode}`, {
        method: "DELETE",
        headers: {
          Accept: "application/json",
          Token: cfg.apiKey,
        },
      });

      if (res.status === 429) {
        throw new Error(
          "La API ha devuelto 429 (demasiadas peticiones). Espera unos minutos.",
        );
      }

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          data?.message ||
            data?.error ||
            `${res.status} ${res.statusText || ""}`,
        );
      }

      if (data && data.status === "error") {
        throw new Error(data.message || "Error API");
      }

      return data;
    },

    // Papelera del TPV: "borrar" un cliente desde el TPV NUNCA toca
    // FacturaScripts -- solo lo esconde de este selector via una tabla
    // propia en el servidor compartido del TPV (parked_tpv_shared). Lectura
    // fail-open (si falla, se trata como papelera vacia y el selector sigue
    // funcionando con normalidad); escritura fail-closed (si falla, se
    // avisa y NO se cae de vuelta al borrado real antiguo).
    async _loadHiddenCustomers() {
      const { syncApiUrl, syncApiKey, slug } = this._getSyncCfg();
      if (!slug || !syncApiKey) return this._hiddenEntries || [];

      try {
        const url = `${syncApiUrl}?action=list-hidden-customers&slug=${encodeURIComponent(slug)}`;
        const res = await fetch(url, {
          headers: { Accept: "application/json", "X-TPV-API-KEY": syncApiKey },
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || data?.ok === false) {
          throw new Error(data?.error || data?.message || `HTTP ${res.status}`);
        }

        const list = Array.isArray(data?.data) ? data.data : [];
        this._hiddenEntries = list
          .map((e) => ({
            codcliente: String(e?.codcliente || "").trim(),
            hiddenAt: e?.hidden_at || null,
            hiddenByTerminalId: String(e?.hidden_by_terminal_id || ""),
            hiddenByTerminalName: String(e?.hidden_by_terminal_name || ""),
          }))
          .filter((e) => e.codcliente);
      } catch (error) {
        this.log(
          "No se pudo cargar la papelera de clientes (fail-open):",
          error?.message || error,
        );
      }

      return this._hiddenEntries || [];
    },

    async _hideCustomerByCode(cod) {
      const code = String(cod || "").trim();
      if (!code) throw new Error("Código de cliente inválido.");

      const { syncApiUrl, syncApiKey, slug } = this._getSyncCfg();
      if (!slug || !syncApiKey) {
        throw new Error(
          "La papelera de clientes no está disponible en esta instalación.",
        );
      }

      const terminal =
        typeof this._getTerminalInfo === "function"
          ? this._getTerminalInfo() || {}
          : {};

      const res = await fetch(`${syncApiUrl}?action=hide-customer`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-TPV-API-KEY": syncApiKey,
        },
        body: JSON.stringify({
          slug,
          codcliente: code,
          terminalId: String(terminal.id || ""),
          terminalName: String(terminal.name || ""),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || data?.message || `HTTP ${res.status}`);
      }
    },

    async _unhideCustomerByCode(cod) {
      const code = String(cod || "").trim();
      if (!code) throw new Error("Código de cliente inválido.");

      const { syncApiUrl, syncApiKey, slug } = this._getSyncCfg();
      if (!slug || !syncApiKey) {
        throw new Error(
          "La papelera de clientes no está disponible en esta instalación.",
        );
      }

      const res = await fetch(`${syncApiUrl}?action=unhide-customer`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-TPV-API-KEY": syncApiKey,
        },
        body: JSON.stringify({ slug, codcliente: code }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || data?.message || `HTTP ${res.status}`);
      }
    },

    // Fallback cuando el borrado definitivo falla (el cliente tiene
    // historial en FacturaScripts): "dar de baja" es un campo NATIVO de
    // FacturaScripts (fechabaja/debaja) -- a diferencia de la papelera, esto
    // SI es un cambio real y visible dentro de FacturaScripts. Se reutiliza
    // _updateForm (ya hace PATCH->PUT fallback).
    async _daBajaCustomer(cod) {
      const today = new Date().toISOString().slice(0, 10);
      await this._updateForm("clientes", cod, { debaja: 1, fechabaja: today });
      await this._unhideCustomerByCode(cod).catch(() => {});
    },

    async _loadCustomers() {
      const baseUrl = String(this._cfg?.baseUrl || "").replace(/\/+$/, "");
      if (!baseUrl) return [];

      const url = `${baseUrl}/clientes?sort[codcliente]=ASC&limit=0`;
      const data = await this._fetchJson(url);
      if (!Array.isArray(data)) return [];

      const list = data
        .filter((customer) => !customer?.debaja)
        .map((customer) => this._normalizeCustomer(customer));
      list.sort((a, b) => Number(a.codcliente) - Number(b.codcliente));
      return list;
    },

    // Recarga la lista real de FacturaScripts y le aplica el filtro de la
    // papelera del TPV. _customersAll conserva el superset (sin el filtro de
    // papelera) para poder mostrar el nombre real de un cliente oculto
    // dentro de la propia papelera; _customers es la vista ya filtrada que
    // usa el selector normal.
    async _refreshCustomers() {
      try {
        this._customersAll = await this._loadCustomers();
      } catch (error) {
        this.log("No pude cargar clientes:", error?.message || error);
        this._customersAll = [];
      }

      const hiddenSet = new Set(
        (this._hiddenEntries || []).map((e) => e.codcliente),
      );
      const list = this._customersAll.filter(
        (c) => !hiddenSet.has(String(c.codcliente)),
      );

      const hasDefault = list.some(
        (customer) => String(customer.codcliente) === String(this._defaultCod),
      );
      if (!hasDefault) {
        list.push({
          codcliente: String(this._defaultCod),
          nombre: String(this._defaultCustomer?.nombre || "Ventas tickets"),
          razonsocial: "",
          cifnif: "",
          _raw: null,
        });
      }

      list.sort((a, b) => Number(a.codcliente) - Number(b.codcliente));
      this._customers = list;
      return this._customers;
    },

    _buildKeyboardHtml() {
      const rows = KEYBOARD_LAYOUT.map(
        (row) =>
          `<div class="csx-kb-row">${row
            .map(
              (keyDef) =>
                `<button type="button" class="csx-kb-key" data-k="${this._escape(keyDef.key)}">${this._escape(keyDef.label)}</button>`,
            )
            .join("")}</div>`,
      ).join("");

      return `
        ${rows}
        <div class="csx-kb-row csx-kb-row-actions">
          <button type="button" class="csx-kb-key csx-kb-key--caps" data-k="CAPS">Mayus</button>
          <button type="button" class="csx-kb-key csx-kb-key--wide" data-k="SPACE">Espacio</button>
          <button type="button" class="csx-kb-key" data-k="BACKSPACE">←</button>
          <button type="button" class="csx-kb-key" data-k="CLEAR">Borrar</button>
        </div>
      `;
    },

    _refreshKeyboardCapsUi() {
      if (!this._els.keyboard) return;

      this._els.keyboard
        .querySelectorAll(".csx-kb-key[data-k]")
        .forEach((key) => {
          const val = String(key.getAttribute("data-k") || "");
          if (val.length !== 1 || !/[a-zñ]/i.test(val)) return;
          key.textContent = this._kbCaps
            ? val.toUpperCase()
            : val.toLowerCase();
        });

      const capsBtn = this._els.keyboard.querySelector('[data-k="CAPS"]');
      if (capsBtn) {
        capsBtn.classList.toggle("is-active", this._kbCaps);
        capsBtn.textContent = this._kbCaps ? "Minus" : "Mayus";
      }
    },

    _ensureModalDom() {
      if (this._els.overlay) return;

      const overlay = document.createElement("div");
      overlay.className = "csx-overlay";
      overlay.innerHTML = `
        <div class="csx-modal csx-list-modal" role="dialog" aria-modal="true">
          <div class="csx-head">
            <div class="csx-title">Seleccionar cliente</div>
            <input class="csx-search" type="text" placeholder="Buscar por nombre, CIF o código..." />
            <button class="csx-btn" type="button" data-csx-search-kb="1" title="Teclado">⌨</button>
            <button class="csx-btn" type="button" data-csx-open-trash="1" title="Papelera de clientes">🗑</button>
            <button class="csx-btn csx-btn-plus" type="button" data-csx-open-create="1" title="Nuevo cliente">+</button>
            <button class="csx-close" type="button" title="Cerrar">✕</button>
          </div>
          <div class="csx-body"></div>
          <div class="csx-foot">
            <div class="csx-foot-left"></div>
            <div class="csx-foot-right">Click para seleccionar</div>
          </div>
        </div>

        <div class="csx-modal csx-create-modal csx-hidden" role="dialog" aria-modal="true">
          <div class="csx-head csx-create-head">
            <div class="csx-title">Nuevo cliente</div>
            <button class="csx-btn" type="button" data-csx-back-list="1">Clientes</button>
            <button class="csx-close" type="button" data-csx-close-create="1" title="Cerrar">✕</button>
          </div>

          <div class="csx-create-layout">
            <div class="csx-create-scroll">
              <form class="csx-create-form" novalidate>
                <div class="csx-field">
                  <label>Nombre</label>
                  <input data-csx-field="nombre" type="text" autocomplete="off" />
                </div>

                <div class="csx-field">
                  <label>Razón social</label>
                  <input data-csx-field="razonsocial" type="text" autocomplete="off" />
                </div>

                <div class="csx-field">
                  <label>Tipo</label>
                  <select data-csx-field="personafisica">
                    <option value="1">Persona física</option>
                    <option value="0">Persona jurídica</option>
                  </select>
                </div>

                <div class="csx-field">
                  <label>Id. fiscal</label>
                  <select data-csx-field="tipoidfiscal">
                    <option value="NIF">NIF</option>
                    <option value="CIF">CIF</option>
                    <option value="NIE">NIE</option>
                    <option value="PASAPORTE">Pasaporte</option>
                  </select>
                </div>

                <div class="csx-field">
                  <label>Núm. fiscal</label>
                  <input data-csx-field="cifnif" type="text" autocomplete="off" />
                </div>

                <div class="csx-field">
                  <label>CIF</label>
                  <input data-csx-field="cif" type="text" autocomplete="off" />
                </div>

                <div class="csx-field csx-field-full">
                  <label>Dirección</label>
                  <input data-csx-field="direccion" type="text" autocomplete="off" />
                </div>

                <div class="csx-field">
                  <label>Apartado</label>
                  <input data-csx-field="apartado" type="text" autocomplete="off" />
                </div>

                <div class="csx-field">
                  <label>Código postal</label>
                  <input data-csx-field="codpostal" type="text" autocomplete="off" />
                </div>

                <div class="csx-field">
                  <label>Ciudad</label>
                  <input data-csx-field="ciudad" type="text" autocomplete="off" />
                </div>

                <div class="csx-field">
                  <label>Provincia</label>
                  <input data-csx-field="provincia" type="text" autocomplete="off" />
                </div>

                <div class="csx-field">
                  <label>País</label>
                  <input data-csx-field="pais" type="text" autocomplete="off" value="España" />
                </div>

                <div class="csx-field">
                  <label>Teléfono</label>
                  <input data-csx-field="telefono1" type="text" autocomplete="off" />
                </div>

                <div class="csx-field csx-field-full">
                  <label>Email</label>
                  <input data-csx-field="email" type="email" autocomplete="off" />
                </div>
              </form>
              <div class="csx-create-error" data-csx-create-error="1"></div>
            </div>

            <div class="csx-kb-panel">
              <div class="csx-kb" data-csx-keyboard="1">
                ${this._buildKeyboardHtml()}
              </div>
            </div>
          </div>

          <div class="csx-create-actions">
            <button class="csx-btn csx-btn-secondary" type="button" data-csx-close-create="1">Cancelar</button>
            <button class="csx-btn csx-btn-primary" type="button" data-csx-save-create="1">Guardar</button>
          </div>
        </div>

        <div class="csx-modal csx-trash-modal csx-hidden" role="dialog" aria-modal="true">
          <div class="csx-head">
            <div class="csx-title">Papelera de clientes</div>
            <button class="csx-btn" type="button" data-csx-back-list-from-trash="1">Clientes</button>
            <button class="csx-close" type="button" data-csx-close-trash="1" title="Cerrar">✕</button>
          </div>
          <div class="csx-body csx-trash-body"></div>
          <div class="csx-foot">
            <div class="csx-foot-left"></div>
            <div class="csx-foot-right">Ocultos del selector del TPV</div>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      this._els.overlay = overlay;
      this._els.listModal = overlay.querySelector(".csx-list-modal");
      this._els.createModal = overlay.querySelector(".csx-create-modal");
      this._els.trashModal = overlay.querySelector(".csx-trash-modal");
      this._els.trashBody = overlay.querySelector(".csx-trash-body");
      this._els.trashCount = this._els.trashModal.querySelector(
        ".csx-foot-left",
      );
      this._els.trashBtn = overlay.querySelector("[data-csx-open-trash]");
      this._els.closeTrashBtn = overlay.querySelector("[data-csx-close-trash]");
      this._els.backListFromTrashBtn = overlay.querySelector(
        "[data-csx-back-list-from-trash]",
      );
      this._els.search = overlay.querySelector(".csx-search");
      this._els.listBody = overlay.querySelector(".csx-body");
      this._els.listCount = overlay.querySelector(".csx-foot-left");
      this._els.listClose = overlay.querySelector(".csx-close");
      this._els.openCreateBtn = overlay.querySelector("[data-csx-open-create]");
      this._els.openSearchKeyboardBtn = overlay.querySelector(
        "[data-csx-search-kb]",
      );
      this._els.backToListBtn = overlay.querySelector("[data-csx-back-list]");
      this._els.createCloseBtns = Array.from(
        overlay.querySelectorAll("[data-csx-close-create]"),
      );
      this._els.createForm = overlay.querySelector(".csx-create-form");
      this._els.createTitle = overlay.querySelector(
        ".csx-create-head .csx-title",
      );
      this._els.saveNewBtn = overlay.querySelector("[data-csx-save-create]");
      this._els.createError = overlay.querySelector("[data-csx-create-error]");
      this._els.keyboard = overlay.querySelector("[data-csx-keyboard]");

      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) this.close();
      });

      this._els.listModal.addEventListener("click", (event) =>
        event.stopPropagation(),
      );
      this._els.createModal.addEventListener("click", (event) =>
        event.stopPropagation(),
      );
      this._els.trashModal.addEventListener("click", (event) =>
        event.stopPropagation(),
      );

      this._els.search.addEventListener("focus", () => {
        this._activeInput = this._els.search;
      });

      this._els.search.addEventListener("input", () => {
        this._renderList(this._els.search.value);
      });

      this._els.listClose.addEventListener("click", () => this.close());
      this._els.openCreateBtn.addEventListener("click", () =>
        this.openCreate(),
      );
      this._els.backToListBtn.addEventListener("click", () => this.open());
      this._els.trashBtn.addEventListener("click", () => this.openTrash());
      this._els.closeTrashBtn.addEventListener("click", () => this.close());
      this._els.backListFromTrashBtn.addEventListener("click", () =>
        this.open(),
      );

      this._els.createCloseBtns.forEach((button) => {
        button.addEventListener("click", () => this.close());
      });

      this._els.openSearchKeyboardBtn.addEventListener("click", () => {
        const qwerty = window.TPV_QWERTY;
        if (qwerty?.openForInput) {
          qwerty.openForInput(this._els.search, "text");
        } else {
          this._activeInput = this._els.search;
        }
      });

      this._els.saveNewBtn.addEventListener("click", () => {
        this._saveNewCustomer().catch((error) => {
          this._setCreateError(error?.message || String(error));
        });
      });

      this._els.createForm.addEventListener("focusin", (event) => {
        const field = event.target.closest("input, textarea");
        if (!field) return;

        this._activeInput = field;
        this._els.createForm
          .querySelectorAll(".csx-field")
          .forEach((row) => row.classList.remove("is-focused"));
        const row = field.closest(".csx-field");
        if (row) row.classList.add("is-focused");
      });

      this._els.keyboard.addEventListener("click", (event) => {
        const button = event.target.closest("[data-k]");
        if (!button) return;
        this._applyKeyboardKey(button.getAttribute("data-k") || "");
      });

      this._els.keyboard.addEventListener("mousedown", (event) => {
        if (event.target.closest("[data-k]")) event.preventDefault();
      });

      this._refreshKeyboardCapsUi();

      window.addEventListener("keydown", (event) => {
        if (event.key === "Escape") this.close();
      });
    },

    _showListMode() {
      this._els.listModal.classList.remove("csx-hidden");
      this._els.createModal.classList.add("csx-hidden");
      this._els.trashModal.classList.add("csx-hidden");
      this._setCreateError("");
      this._activeInput = this._els.search;
    },

    _showCreateMode() {
      this._els.createModal.classList.remove("csx-hidden");
      this._els.listModal.classList.add("csx-hidden");
      this._els.trashModal.classList.add("csx-hidden");
      this._setCreateError("");

      const isEdit = this._createMode === "edit";
      if (this._els.createTitle) {
        this._els.createTitle.textContent = isEdit
          ? "Editar cliente"
          : "Nuevo cliente";
      }
      if (this._els.saveNewBtn) {
        this._els.saveNewBtn.textContent = isEdit
          ? "Guardar cambios"
          : "Guardar";
      }

      const first = this._els.createForm.querySelector(
        '[data-csx-field="nombre"]',
      );
      if (first) {
        first.focus();
        this._activeInput = first;
      }
    },

    _showTrashMode() {
      this._els.trashModal.classList.remove("csx-hidden");
      this._els.listModal.classList.add("csx-hidden");
      this._els.createModal.classList.add("csx-hidden");
    },

    // "Borrar" desde el selector normal nunca toca FacturaScripts -- solo
    // esconde al cliente en la papelera del TPV (ver _hideCustomerByCode).
    async _confirmHideCustomer(customer) {
      const name = String(
        customer?.nombre || customer?.razonsocial || "",
      ).trim();
      const code = String(customer?.codcliente || "").trim();
      const label = name ? `${name}` : `cliente ${code}`;

      const msg =
        `Los clientes borrados se meterán en la papelera, puedes volver a ` +
        `activarlos; mientras estén en la papelera no los verás para ` +
        `poder seleccionarlos.\n\n¿Borrar a "${label}"?`;

      if (typeof window.confirmModal === "function") {
        return !!(await window.confirmModal("Borrar cliente", msg));
      }

      return window.confirm(msg);
    },

    _setCreateError(text) {
      if (!this._els.createError) return;
      const message = String(text || "").trim();
      this._els.createError.textContent = message;
      this._els.createError.classList.toggle("is-visible", !!message);
    },

    _canDeleteCustomer(cod) {
      const customerCode = String(cod || "").trim();
      if (!customerCode) return false;

      if (customerCode === String(this._defaultCod || "1")) return false;
      if (customerCode === String(this._selected?.codcliente || ""))
        return false;
      return true;
    },

    _renderList(term) {
      const body = this._els.listBody;
      const foot = this._els.listCount;
      if (!body) return;

      const text = normalizeCustomerSearchText(String(term || "").trim());
      const selectedCod = String(
        this._selected?.codcliente || this._defaultCod,
      );

      const list = (this._customers || []).filter((customer) => {
        if (!text) return true;
        const haystack = normalizeCustomerSearchText(
          `${customer.codcliente} ${customer.nombre} ${customer.razonsocial} ${customer.cifnif}`,
        );
        return haystack.includes(text);
      });

      foot.textContent = `${list.length} clientes`;

      body.innerHTML = list
        .map((customer) => {
          const code = String(customer.codcliente || "");
          const isSelected = code === selectedCod;
          const sub = [customer.razonsocial, customer.cifnif]
            .filter(Boolean)
            .join(" · ");
          const canDelete = this._canDeleteCustomer(code);
          const canEdit = !!code;

          return `
            <div class="csx-row ${isSelected ? "csx-selected" : ""}" data-cod="${this._escape(code)}">
              <div class="csx-cod">${this._escape(code)}</div>
              <div class="csx-row-main">
                <div class="csx-name">${this._escape(customer.nombre || "—")}</div>
                ${sub ? `<div class="csx-sub">${this._escape(sub)}</div>` : ""}
              </div>
              <div class="csx-row-actions">
                ${canEdit ? `<button type="button" class="csx-edit" data-csx-edit="${this._escape(code)}" title="Editar cliente">✎</button>` : `<span class="csx-del-placeholder"></span>`}
                ${canDelete ? `<button type="button" class="csx-del" data-csx-del="${this._escape(code)}" title="Borrar cliente">✖</button>` : `<span class="csx-del-placeholder"></span>`}
              </div>
            </div>
          `;
        })
        .join("");

      body.querySelectorAll("[data-csx-edit]").forEach((button) => {
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();

          const cod = button.getAttribute("data-csx-edit") || "";
          if (!cod) return;

          const customer = (this._customers || []).find(
            (item) => String(item.codcliente) === String(cod),
          );
          if (!customer) return;

          this.openEdit(customer);
        });
      });

      body.querySelectorAll(".csx-row").forEach((row) => {
        row.addEventListener("click", () => {
          const cod = row.getAttribute("data-cod") || "";
          if (!cod || cod === selectedCod) return;

          const found = (this._customers || []).find(
            (item) => String(item.codcliente) === String(cod),
          );
          if (found) this.setSelected(found);
          this.close();
        });
      });

      body.querySelectorAll("[data-csx-del]").forEach((button) => {
        button.addEventListener("click", async (event) => {
          event.preventDefault();
          event.stopPropagation();

          const cod = button.getAttribute("data-csx-del") || "";
          if (!this._canDeleteCustomer(cod)) return;

          const customer = (this._customers || []).find(
            (item) => String(item.codcliente) === String(cod),
          );

          const confirmed = await this._confirmHideCustomer(customer);
          if (!confirmed) return;

          button.disabled = true;
          try {
            await this._hideCustomerByCode(cod);
            this._hiddenEntries = (this._hiddenEntries || []).filter(
              (e) => e.codcliente !== String(cod),
            );
            this._hiddenEntries.push({ codcliente: String(cod) });
            await this._refreshCustomers();
            this._renderList(this._els.search.value);
            if (typeof window.toast === "function") {
              window.toast("Cliente movido a la papelera 🗑", "ok", "Clientes");
            }
          } catch (error) {
            const msg = `No se pudo borrar el cliente: ${error?.message || error}`;
            if (typeof window.confirmModal === "function") {
              await window.confirmModal("No se pudo borrar", msg);
            } else {
              alert(msg);
            }
          } finally {
            button.disabled = false;
          }
        });
      });
    },

    _renderTrashList() {
      const body = this._els.trashBody;
      const foot = this._els.trashCount;
      const entries = this._hiddenEntries || [];

      foot.textContent = `${entries.length} cliente${entries.length === 1 ? "" : "s"} en la papelera`;

      body.innerHTML =
        entries
          .map((entry) => {
            const customer = (this._customersAll || []).find(
              (c) => String(c.codcliente) === entry.codcliente,
            );
            const name = customer?.nombre || "(no encontrado en FacturaScripts)";
            const meta = [entry.hiddenAt, entry.hiddenByTerminalName]
              .filter(Boolean)
              .join(" · ");

            return `
              <div class="csx-row csx-trash-row" data-cod="${this._escape(entry.codcliente)}">
                <div class="csx-cod">${this._escape(entry.codcliente)}</div>
                <div class="csx-row-main">
                  <div class="csx-name">${this._escape(name)}</div>
                  ${meta ? `<div class="csx-sub">${this._escape(meta)}</div>` : ""}
                </div>
                <div class="csx-row-actions">
                  <button type="button" class="csx-btn csx-btn-secondary" data-csx-reactivar="${this._escape(entry.codcliente)}">Reactivar</button>
                  <button type="button" class="csx-del-text" data-csx-borrar-def="${this._escape(entry.codcliente)}">Borrar definitivamente</button>
                </div>
              </div>
            `;
          })
          .join("") || `<div class="csx-trash-empty">La papelera está vacía.</div>`;

      this._wireTrashRowActions(body);
    },

    _wireTrashRowActions(body) {
      body.querySelectorAll("[data-csx-reactivar]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const cod = btn.getAttribute("data-csx-reactivar") || "";
          btn.disabled = true;
          try {
            await this._unhideCustomerByCode(cod);
            this._hiddenEntries = (this._hiddenEntries || []).filter(
              (e) => e.codcliente !== cod,
            );
            await this._refreshCustomers();
            this._renderTrashList();
            if (typeof window.toast === "function") {
              window.toast("Cliente reactivado ✅", "ok", "Clientes");
            }
          } catch (error) {
            await window.confirmModal?.(
              "No se pudo reactivar",
              error?.message || String(error),
            );
          } finally {
            btn.disabled = false;
          }
        });
      });

      body.querySelectorAll("[data-csx-borrar-def]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const cod = btn.getAttribute("data-csx-borrar-def") || "";
          const customer = (this._customersAll || []).find(
            (c) => String(c.codcliente) === cod,
          );
          const label = customer?.nombre || `cliente ${cod}`;

          const confirmed = await window.confirmModal(
            "Borrar definitivamente",
            `Vas a intentar borrar a "${label}" de FacturaScripts de forma ` +
              `permanente. Esta acción no se puede deshacer. ¿Continuar?`,
          );
          if (!confirmed) return;

          btn.disabled = true;
          try {
            await this._deleteCustomerByCode(cod);
            await this._unhideCustomerByCode(cod).catch(() => {});
            this._hiddenEntries = (this._hiddenEntries || []).filter(
              (e) => e.codcliente !== cod,
            );
            this._customersAll = (this._customersAll || []).filter(
              (c) => String(c.codcliente) !== cod,
            );
            this._renderTrashList();
            if (typeof window.toast === "function") {
              window.toast(
                "Cliente borrado definitivamente ✅",
                "ok",
                "Clientes",
              );
            }
          } catch (error) {
            const choice = await window.confirmModal(
              "No se pudo borrar definitivamente",
              `FacturaScripts ha rechazado el borrado de "${label}" (motivo ` +
                `más probable: tiene facturas, presupuestos, pedidos o ` +
                `albaranes asociados). Puedes darlo de baja en ` +
                `FacturaScripts en su lugar: mantiene todo su historial, ` +
                `pero a diferencia del borrado o de esconderlo en la ` +
                `papelera del TPV, esto SÍ es un cambio real y visible ` +
                `dentro de FacturaScripts (aparecerá "de baja" allí ` +
                `también).`,
              {
                middleButtonText: "Dar de baja en FacturaScripts",
                middleButtonResult: "baja",
                okButtonText: "Entendido",
              },
            );

            if (choice === "baja") {
              const reallyConfirm = await window.confirmModal(
                "Confirmar baja en FacturaScripts",
                `Esto modificará a "${label}" DENTRO de FacturaScripts (no ` +
                  `solo en el TPV). ¿Seguro?`,
              );
              if (reallyConfirm) {
                try {
                  await this._daBajaCustomer(cod);
                  this._hiddenEntries = (this._hiddenEntries || []).filter(
                    (e) => e.codcliente !== cod,
                  );
                  this._renderTrashList();
                  if (typeof window.toast === "function") {
                    window.toast(
                      "Cliente dado de baja en FacturaScripts ✅",
                      "ok",
                      "Clientes",
                    );
                  }
                } catch (e2) {
                  await window.confirmModal(
                    "No se pudo dar de baja",
                    e2?.message || String(e2),
                  );
                }
              }
            }
          } finally {
            btn.disabled = false;
          }
        });
      });
    },

    _emitChange() {
      const customer = this.getSelectedCustomer();
      if (typeof this._onChange === "function") this._onChange(customer);
    },

    _getCreateData() {
      const get = (name) => {
        const field = this._els.createForm?.querySelector(
          `[data-csx-field="${name}"]`,
        );
        return String(field?.value || "").trim();
      };

      const razon = get("razonsocial");
      const nombre = get("nombre");

      return {
        razonsocial: razon,
        nombre,
        personafisica: get("personafisica") || "1",
        tipoidfiscal: get("tipoidfiscal") || "NIF",
        cifnif: get("cifnif"),
        cif: get("cif"),
        direccion: get("direccion"),
        apartado: get("apartado"),
        codpostal: get("codpostal"),
        ciudad: get("ciudad"),
        provincia: get("provincia"),
        pais: get("pais"),
        telefono1: get("telefono1"),
        email: get("email"),
      };
    },

    _buildCreatePayload(data) {
      const razon = String(data.razonsocial || "").trim();
      const nombre = String(data.nombre || "").trim();
      const finalRazon = razon || nombre;
      const finalNombre = nombre || razon;
      const fiscalNumber = String(data.cifnif || "").trim();
      const cif = String(data.cif || "").trim();
      const nif = cif || fiscalNumber || " ";

      const payload = {
        razonsocial: finalRazon,
        nombre: finalNombre,
        personafisica: data.personafisica || "1",
        tipoidfiscal: data.tipoidfiscal || "NIF",
        cifnif: nif,
        direccion: data.direccion || "",
        apartado: data.apartado || "",
        codpostal: data.codpostal || "",
        ciudad: data.ciudad || "",
        provincia: data.provincia || "",
        pais: data.pais || "",
        telefono1: data.telefono1 || "",
        email: data.email || "",
      };

      // Evita enviar claves vacías que en algunos entornos de FacturaScripts fallan.
      Object.keys(payload).forEach((key) => {
        if (payload[key] === "") delete payload[key];
      });

      return payload;
    },

    _setCreateFormValue(name, value) {
      const input = this._els.createForm?.querySelector(
        `[data-csx-field="${name}"]`,
      );
      if (!input) return;
      input.value = String(value ?? "");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    },

    _fillCreateFormForCustomer(customer) {
      const raw =
        customer?._raw && typeof customer._raw === "object"
          ? customer._raw
          : customer || {};

      this._setCreateFormValue("nombre", raw?.nombre || customer?.nombre || "");
      this._setCreateFormValue(
        "razonsocial",
        raw?.razonsocial || customer?.razonsocial || "",
      );
      this._setCreateFormValue(
        "personafisica",
        String(raw?.personafisica ?? "1"),
      );
      this._setCreateFormValue("tipoidfiscal", raw?.tipoidfiscal || "NIF");
      this._setCreateFormValue("cifnif", raw?.cifnif || customer?.cifnif || "");
      this._setCreateFormValue("cif", raw?.cif || "");
      this._setCreateFormValue("direccion", raw?.direccion || "");
      this._setCreateFormValue("apartado", raw?.apartado || "");
      this._setCreateFormValue("codpostal", raw?.codpostal || "");
      this._setCreateFormValue("ciudad", raw?.ciudad || "");
      this._setCreateFormValue("provincia", raw?.provincia || "");
      this._setCreateFormValue("pais", raw?.pais || "España");
      this._setCreateFormValue("telefono1", raw?.telefono1 || "");
      this._setCreateFormValue("email", raw?.email || "");
    },

    async _saveEditedCustomer() {
      const cod = String(this._editingCustomerCod || "").trim();
      if (!cod) throw new Error("Cliente inválido para editar.");

      const data = this._getCreateData();
      if (!data.razonsocial && !data.nombre) {
        throw new Error("Debes indicar razón social o nombre.");
      }

      const selectedCodBefore = String(
        this.getSelectedCustomerCodcliente() || "",
      );
      const payload = this._buildCreatePayload(data);

      this._setCreateError("");
      this._els.saveNewBtn.disabled = true;

      try {
        await this._updateForm("clientes", cod, payload);
        await this._refreshCustomers();

        const refreshed = this._customers.find(
          (customer) => String(customer.codcliente) === cod,
        );

        if (selectedCodBefore === cod && refreshed) {
          this._selected = refreshed;
          this._emitChange();
        }

        if (String(this._defaultCod) === cod) {
          this._defaultCustomer = {
            codcliente: String(cod),
            nombre: String(
              refreshed?.nombre || payload.nombre || "Ventas tickets",
            ),
          };
          if (!this._selected) this._emitChange();
        }

        if (typeof window.toast === "function") {
          window.toast("Cliente actualizado ✅", "ok", "Clientes");
        }

        this.close();
      } finally {
        this._els.saveNewBtn.disabled = false;
      }
    },

    async _saveNewCustomer() {
      if (this._createMode === "edit") {
        return this._saveEditedCustomer();
      }

      const data = this._getCreateData();
      if (!data.razonsocial && !data.nombre) {
        throw new Error("Debes indicar razón social o nombre.");
      }

      this._setCreateError("");
      this._els.saveNewBtn.disabled = true;

      try {
        const previousCodes = new Set(
          (this._customers || []).map((customer) =>
            String(customer.codcliente),
          ),
        );

        const payload = this._buildCreatePayload(data);
        const createdRaw = await this._postForm("clientes", payload);

        let created = null;
        if (
          createdRaw &&
          typeof createdRaw === "object" &&
          createdRaw.codcliente
        ) {
          created = this._normalizeCustomer(createdRaw);
        }

        await this._refreshCustomers();

        if (!created) {
          created = this._customers.find(
            (customer) =>
              !previousCodes.has(String(customer.codcliente)) &&
              String(customer.razonsocial || "").toLowerCase() ===
                String(payload.razonsocial || "").toLowerCase(),
          );
        }

        if (!created) {
          created = this._customers[this._customers.length - 1] || null;
        }

        if (!created) {
          throw new Error("No se pudo confirmar el nuevo cliente en la lista.");
        }

        this.setSelected(created);
        this.close();
      } finally {
        this._els.saveNewBtn.disabled = false;
      }
    },

    _applyKeyboardKey(key) {
      const action = String(key || "");
      if (!action) return;

      if (
        !this._activeInput ||
        this._activeInput.disabled ||
        this._activeInput.readOnly
      ) {
        const first = this._els.createForm?.querySelector(
          'input[data-csx-field="nombre"]',
        );
        if (first) {
          first.focus();
          this._activeInput = first;
        }
      }

      const input = this._activeInput;
      if (!input) return;

      if (action === "CLEAR") {
        input.value = "";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return;
      }

      const start = Number(input.selectionStart ?? input.value.length);
      const end = Number(input.selectionEnd ?? input.value.length);
      const value = String(input.value || "");

      if (action === "CAPS") {
        this._kbCaps = !this._kbCaps;
        this._refreshKeyboardCapsUi();
        input.focus();
        return;
      }

      if (action === "BACKSPACE") {
        if (start === end && start > 0) {
          input.value = value.slice(0, start - 1) + value.slice(end);
          input.setSelectionRange(start - 1, start - 1);
        } else {
          input.value = value.slice(0, start) + value.slice(end);
          input.setSelectionRange(start, start);
        }
      } else {
        let token = action === "SPACE" ? " " : action;
        if (token.length === 1 && /[a-zñ]/i.test(token)) {
          token = this._kbCaps ? token.toUpperCase() : token.toLowerCase();
        }
        input.value = value.slice(0, start) + token + value.slice(end);
        const caret = start + token.length;
        input.setSelectionRange(caret, caret);
      }

      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus();
    },

    _resetCreateForm() {
      if (!this._els.createForm) return;

      this._createMode = "create";
      this._editingCustomerCod = "";

      this._els.createForm.reset();

      const fiscalType = this._els.createForm.querySelector(
        '[data-csx-field="tipoidfiscal"]',
      );
      const personType = this._els.createForm.querySelector(
        '[data-csx-field="personafisica"]',
      );
      const country = this._els.createForm.querySelector(
        '[data-csx-field="pais"]',
      );

      if (fiscalType) fiscalType.value = "NIF";
      if (personType) personType.value = "1";
      if (country) country.value = "España";
      this._kbCaps = false;
      this._refreshKeyboardCapsUi();

      this._activeInput = null;
      this._els.createForm
        .querySelectorAll(".csx-field")
        .forEach((row) => row.classList.remove("is-focused"));
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

      const found = (this._customers || []).find(
        (customer) => String(customer.codcliente) === nextCod,
      );

      this._defaultCustomer = {
        codcliente: nextCod,
        nombre: found?.nombre ? String(found.nombre) : "Ventas tickets",
      };

      if (!this._selected) this._emitChange();
    },

    open() {
      this._ensureModalDom();
      this._showListMode();
      this._els.overlay.classList.add("csx-open");
      this._els.search.value = "";
      this._renderList("");
      setTimeout(() => this._els.search.focus(), 0);
    },

    openCreate() {
      this._ensureModalDom();
      this._els.overlay.classList.add("csx-open");
      this._createMode = "create";
      this._editingCustomerCod = "";
      this._resetCreateForm();
      this._showCreateMode();
    },

    openEdit(customerObj) {
      this._ensureModalDom();

      const cod = String(customerObj?.codcliente || "").trim();
      if (!cod) return;

      this._createMode = "edit";
      this._editingCustomerCod = cod;

      this._els.overlay.classList.add("csx-open");
      this._resetCreateForm();
      this._createMode = "edit";
      this._editingCustomerCod = cod;
      this._fillCreateFormForCustomer(customerObj);
      this._showCreateMode();
    },

    async openTrash() {
      this._ensureModalDom();
      this._els.overlay.classList.add("csx-open");
      this._showTrashMode();
      this._els.trashBody.innerHTML = `<div class="csx-trash-loading">Cargando…</div>`;
      await this._loadHiddenCustomers();
      this._renderTrashList();
    },

    close() {
      if (!this._els.overlay) return;
      this._els.overlay.classList.remove("csx-open");
      this._showListMode();
      this._resetCreateForm();
    },

    async mount({
      baseUrl,
      apiKey,
      defaultCodcliente = "1",
      onChange,
      getTerminalInfo,
      debug = false,
    }) {
      this._cfg = {
        baseUrl: String(baseUrl || "").replace(/\/+$/, ""),
        apiKey: String(apiKey || "").trim(),
      };
      this._defaultCod = String(defaultCodcliente || "1");
      this._onChange = onChange;
      this._getTerminalInfo =
        typeof getTerminalInfo === "function" ? getTerminalInfo : null;
      this._debug = !!debug;

      this._ensureModalDom();

      this._hiddenEntries = await this._loadHiddenCustomers().catch(() => []);
      await this._refreshCustomers();
      this._emitChange();
    },
  };

  window.CUSTOMER_SELECTOR = CSX;
})();
