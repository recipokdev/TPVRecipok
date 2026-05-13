(function () {
  "use strict";

  const APP_MODE_KEY = "tpv_app_mode";
  const THEME_MODE_KEY = "tpv_theme_mode";
  const TABLES_STATE_KEY = "tpv_tables_state_v3";
  const LEGACY_TABLES_STATE_KEY = "tpv_tables_state_v2";
  const SHARED_CATALOG_CACHE_KEY = "tpv_shared_catalog_v1";

  function normalizeBaseUrl(baseUrl) {
    return String(baseUrl || "")
      .trim()
      .replace(/\/+$/, "");
  }

  function safeParseJson(raw) {
    try {
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function readLocalStorage(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function writeLocalStorage(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }

  const bridge = {
    getAppMode() {
      const mode = String(readLocalStorage(APP_MODE_KEY) || "")
        .trim()
        .toLowerCase();
      return mode === "mesas" ? "mesas" : mode === "tpv" ? "tpv" : "";
    },

    setAppMode(mode) {
      const next =
        String(mode || "tpv").toLowerCase() === "mesas" ? "mesas" : "tpv";
      writeLocalStorage(APP_MODE_KEY, next);
      return next;
    },

    getThemeMode() {
      const mode = String(readLocalStorage(THEME_MODE_KEY) || "light")
        .trim()
        .toLowerCase();
      return mode === "dark" ? "dark" : "light";
    },

    getTablesStateRaw() {
      return (
        readLocalStorage(TABLES_STATE_KEY) ||
        readLocalStorage(LEGACY_TABLES_STATE_KEY) ||
        null
      );
    },

    setTablesStateRaw(rawJson) {
      return writeLocalStorage(TABLES_STATE_KEY, String(rawJson || ""));
    },

    getSharedCatalog(baseUrl) {
      const normalizedBase = normalizeBaseUrl(baseUrl);
      const parsed = safeParseJson(readLocalStorage(SHARED_CATALOG_CACHE_KEY));
      if (!parsed || typeof parsed !== "object") return null;

      if (normalizeBaseUrl(parsed.baseUrl) !== normalizedBase) return null;

      const categories = Array.isArray(parsed.categories)
        ? parsed.categories
        : [];
      const products = Array.isArray(parsed.products) ? parsed.products : [];
      if (!categories.length || !products.length) return null;

      return {
        baseUrl: normalizedBase,
        categories,
        products,
        ts: Number(parsed.ts || 0) || 0,
        source: String(parsed.source || ""),
      };
    },

    setSharedCatalog(baseUrl, categories, products, source) {
      const normalizedBase = normalizeBaseUrl(baseUrl);
      const safeCategories = Array.isArray(categories) ? categories : [];
      const safeProducts = Array.isArray(products) ? products : [];

      if (!normalizedBase || !safeCategories.length || !safeProducts.length) {
        return false;
      }

      const payload = {
        version: 1,
        ts: Date.now(),
        baseUrl: normalizedBase,
        categories: safeCategories,
        products: safeProducts,
        source: String(source || "mesas-bridge"),
      };

      return writeLocalStorage(
        SHARED_CATALOG_CACHE_KEY,
        JSON.stringify(payload),
      );
    },
  };

  window.MESAS_BRIDGE = bridge;
})();
