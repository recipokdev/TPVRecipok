process.env.TPV_E2E = process.env.TPV_E2E || "1";
process.env.TPV_MODE = process.env.TPV_MODE || "demo";
process.env.TPV_E2E_BASE_URL =
  process.env.TPV_E2E_BASE_URL || "https://plus.recipok.com/demo/api/3";
process.env.TPV_E2E_API_KEY =
  process.env.TPV_E2E_API_KEY || "ST5K5zJOu9r6S63xPx6L";
process.env.TPV_E2E_REQUIRE_ONLINE = process.env.TPV_E2E_REQUIRE_ONLINE || "1";
process.env.TPV_E2E_ALLOW_WRITES = process.env.TPV_E2E_ALLOW_WRITES || "1";
process.env.TPV_E2E_RUN_RESILIENCE = process.env.TPV_E2E_RUN_RESILIENCE || "0";
process.env.TPV_E2E_BACKGROUND = process.env.TPV_E2E_BACKGROUND || "1";
process.env.TPV_E2E_ONLY_MESAS = process.env.TPV_E2E_ONLY_MESAS || "1";

require("./run-e2e-smoke.js");
