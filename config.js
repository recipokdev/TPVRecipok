// Configuración de la API de Recipok / FacturaScripts
window.RECIPOK_API = {
  // Versión 3 de la API REST de FacturaScripts
  baseUrl: "",
  apiKey: "",

  // NUEVOS CAMPOS PARA EL TPV
  defaultCodClienteTPV: "1", // código del cliente genérico de mostrador
  defaultCodPagoTPV: "CONT", // forma de pago por defecto (efectivo)
  defaultCodSerieTPV: "T", // serie por defecto para tickets/facturas TPV
};

window.TPV_CONFIG = {
  resolverUrl: "https://plus.recipok.com/tpv/clients.json",
  tpvSyncApiUrl: "https://plus.recipok.com/tpv/api/index.php",
  tpvApiKey: "HhF8gfNocCy626jBn6oS5DS9h5xONQ1k",
};
