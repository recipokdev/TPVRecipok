// Proceso principal minimo de Electron: solo existe para que build-manual.js genere PDFs con printToPDF.
const { app } = require("electron");
app.on("window-all-closed", () => {});
