const { normalizeScaleConfig, parseScalePayload } = require("./scale-parser");

class ScaleManager {
  constructor() {
    this.SerialPort = null;
    this.port = null;
    this.config = normalizeScaleConfig({});
    this.onStateChange = null;

    this.buffer = "";
    this.flushTimer = null;

    this.state = {
      connected: false,
      enabled: false,
      portPath: "",
      lastRaw: "",
      currentGrams: 0,
      currentKg: 0,
      updatedAt: 0,
      error: null,
      lockedUntilWeightChanges: false,
      lastConsumedGrams: null,
    };
  }

  async ensureSerialPortLib() {
    if (this.SerialPort) return this.SerialPort;

    const serialport = require("serialport");
    this.SerialPort = serialport.SerialPort;
    return this.SerialPort;
  }

  async listPorts() {
    const SerialPort = await this.ensureSerialPortLib();
    const ports = await SerialPort.list();

    return (ports || []).map((p) => ({
      path: p.path,
      manufacturer: p.manufacturer || "",
      friendlyName: p.friendlyName || p.displayName || p.path || "",
      serialNumber: p.serialNumber || "",
      vendorId: p.vendorId || "",
      productId: p.productId || "",
    }));
  }

  setOnStateChange(fn) {
    this.onStateChange = fn;
  }

  getState() {
    return {
      ...this.state,
      config: this.config,
    };
  }

  emitState() {
    if (typeof this.onStateChange === "function") {
      this.onStateChange(this.getState());
    }
  }

  setStatePatch(patch = {}) {
    this.state = {
      ...this.state,
      ...patch,
    };
    this.emitState();
  }

  clearFlushTimer() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  flushBuffer() {
    const chunk = String(this.buffer || "").trim();
    this.buffer = "";
    if (!chunk) return;
    this.processFrame(chunk);
  }

  handleIncomingChunk(chunk) {
    const txt = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);

    if (this.config.parserMode === "delimiter") {
      this.buffer += txt;

      const delimiter = this.config.delimiter || "\r\n";
      let idx = this.buffer.indexOf(delimiter);

      while (idx !== -1) {
        const frame = this.buffer.slice(0, idx);
        this.buffer = this.buffer.slice(idx + delimiter.length);
        this.processFrame(frame);
        idx = this.buffer.indexOf(delimiter);
      }

      return;
    }

    this.buffer += txt;
    this.clearFlushTimer();
    this.flushTimer = setTimeout(() => {
      this.flushBuffer();
    }, this.config.interByteMs);
  }

  processFrame(frame) {
    const parsed = parseScalePayload(frame, this.config);
    if (!parsed) return;

    const now = Date.now();

    if (this.state.lockedUntilWeightChanges) {
      const lastConsumed = Number(this.state.lastConsumedGrams || 0);
      const tolerance = Number(this.config.relockToleranceGrams || 0);
      const diff = Math.abs(parsed.grams - lastConsumed);

      if (parsed.grams === 0 || diff > tolerance) {
        this.state.lockedUntilWeightChanges = false;
        this.state.lastConsumedGrams = null;
      }
    }

    this.setStatePatch({
      lastRaw: parsed.raw,
      currentGrams: parsed.grams,
      currentKg: parsed.kg,
      updatedAt: now,
      error: null,
    });
  }

  async connect(inputConfig = {}) {
    await this.disconnect();

    this.config = normalizeScaleConfig(inputConfig);

    if (!this.config.portPath) {
      throw new Error("No se ha indicado el puerto de la báscula.");
    }

    const SerialPort = await this.ensureSerialPortLib();

    this.port = new SerialPort({
      path: this.config.portPath,
      baudRate: this.config.baudRate,
      dataBits: this.config.dataBits,
      stopBits: this.config.stopBits,
      parity: this.config.parity,
      autoOpen: false,
    });

    this.port.on("data", (chunk) => {
      this.handleIncomingChunk(chunk);
    });

    this.port.on("error", (err) => {
      this.setStatePatch({
        error: err?.message || String(err),
      });
    });

    this.port.on("close", () => {
      this.setStatePatch({
        connected: false,
      });
    });

    await new Promise((resolve, reject) => {
      this.port.open((err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    this.buffer = "";
    this.setStatePatch({
      connected: true,
      enabled: !!this.config.enabled,
      portPath: this.config.portPath,
      error: null,
      currentGrams: 0,
      currentKg: 0,
      updatedAt: 0,
      lastRaw: "",
      lockedUntilWeightChanges: false,
      lastConsumedGrams: null,
    });

    return this.getState();
  }

  async disconnect() {
    this.clearFlushTimer();
    this.buffer = "";

    if (!this.port) {
      this.setStatePatch({
        connected: false,
      });
      return;
    }

    const portToClose = this.port;
    this.port = null;

    await new Promise((resolve) => {
      try {
        if (portToClose.isOpen) {
          portToClose.close(() => resolve());
        } else {
          resolve();
        }
      } catch (_) {
        resolve();
      }
    });

    this.setStatePatch({
      connected: false,
    });
  }

  async setEnabled(enabled, inputConfig = null) {
    if (!enabled) {
      this.config = normalizeScaleConfig({
        ...this.config,
        enabled: false,
      });

      await this.disconnect();

      this.setStatePatch({
        enabled: false,
        currentGrams: 0,
        currentKg: 0,
        updatedAt: 0,
        lastRaw: "",
        lockedUntilWeightChanges: false,
        lastConsumedGrams: null,
      });

      return this.getState();
    }

    const nextCfg = normalizeScaleConfig({
      ...this.config,
      ...(inputConfig || {}),
      enabled: true,
    });

    this.config = nextCfg;
    return this.connect(nextCfg);
  }

  consumeWeight() {
    if (!this.state.enabled || !this.state.connected) {
      return { ok: false, error: "La báscula no está activa." };
    }

    if (!this.state.updatedAt) {
      return { ok: false, error: "No hay lectura disponible." };
    }

    if (!this.state.currentGrams || this.state.currentGrams <= 0) {
      return { ok: false, error: "No hay peso válido en la báscula." };
    }

    const grams = Number(this.state.currentGrams || 0);
    const kg = Number(this.state.currentKg || 0);

    if (this.config.consumeMode === "continuous") {
      return {
        ok: true,
        grams,
        kg,
        raw: this.state.lastRaw,
        updatedAt: this.state.updatedAt,
      };
    }

    const age = Date.now() - this.state.updatedAt;
    if (age > this.config.maxAgeMs) {
      return { ok: false, error: "La lectura de la báscula está caducada." };
    }

    if (this.state.lockedUntilWeightChanges) {
      return {
        ok: false,
        error: "Ese peso ya se ha usado. Cambia el peso o deja la báscula a 0.",
      };
    }

    this.setStatePatch({
      lockedUntilWeightChanges: true,
      lastConsumedGrams: grams,
    });

    return {
      ok: true,
      grams,
      kg,
      raw: this.state.lastRaw,
      updatedAt: this.state.updatedAt,
    };
  }
}

module.exports = {
  ScaleManager,
};
