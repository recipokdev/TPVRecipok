// preview_preload.js
// Preload minimo para la ventana de PREVISUALIZACION de ticket (solo pruebas,
// npm start). Expone un unico puente para que el boton "Imprimir" de la ventana
// mande a imprimir el ticket que se esta previsualizando, en la impresora real.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("PREVIEW", {
  print: () => ipcRenderer.invoke("ticket:previewPrint"),
});
