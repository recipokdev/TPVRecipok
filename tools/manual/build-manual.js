// Genera el manual del TPV en PDF a partir de docs/manual/*.md
//   node tools/manual/build-manual.js            -> manual general + manual de Modo Mesas + un PDF por capitulo general
//   node tools/manual/build-manual.js 02-vender  -> solo los PDF cuyo capitulo empiece asi (04-modo-mesas = el manual de Mesas)
// El Modo Mesas es un modulo que no tienen todos los clientes: va en su propio manual, fuera del general.
// Salida: docs/manual/pdf/ (excluida de git). Los capitulos son ficheros NN-nombre.md con un markdown sencillo:
//   # Titulo (capitulo) / ## seccion / ### subseccion / parrafos / "- " listas / "1. " numeradas / **negrita** / *cursiva*
//   > nota          (cuadro destacado)
//   @fig ruta | crop=x,y,w,h | marks=1:x,y;2:x,y | pie de foto     (captura recortada con marcadores numerados;
//                    las coordenadas son pixeles de la imagen original)
const fs = require("fs");
const path = require("path");
const { _electron: electron } = require("playwright");

const ROOT = path.resolve(__dirname, "..", "..");
const SRC = path.join(ROOT, "docs", "manual");
const OUT = path.join(SRC, "pdf");
const filter = process.argv[2] || "";
const MESAS_ID = "04-modo-mesas"; // modulo opcional: manual aparte

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inline = (s) =>
  esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
const slug = (s) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

function pngSize(file) {
  const b = fs.readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

function figure(line, chapterId) {
  const parts = line.slice(5).split("|").map((x) => x.trim());
  const file = parts[0];
  const abs = path.join(SRC, file);
  const full = pngSize(abs);
  let crop = { x: 0, y: 0, w: full.w, h: full.h };
  let marks = [];
  let widthPct = 100;
  const caption = parts.filter((p) => !/^(crop|marks|width)=/.test(p)).slice(1).join(" | ");
  for (const p of parts.slice(1)) {
    if (p.startsWith("crop=")) {
      const [x, y, w, h] = p.slice(5).split(",").map(Number);
      crop = { x, y, w, h };
    } else if (p.startsWith("width=")) {
      widthPct = Math.min(100, Math.max(20, Number(p.slice(6)) || 100));
    } else if (p.startsWith("marks=")) {
      marks = p
        .slice(6)
        .split(";")
        .map((m) => {
          const [n, xy] = m.split(":");
          const [x, y] = xy.split(",").map(Number);
          return { n, x, y };
        });
    }
  }
  const imgW = (full.w / crop.w) * 100;
  const left = -(crop.x / crop.w) * 100;
  const top = -(crop.y / crop.h) * 100;
  const dots = marks
    .map((m) => {
      const px = ((m.x - crop.x) / crop.w) * 100;
      const py = ((m.y - crop.y) / crop.h) * 100;
      return `<span class="mark" style="left:${px}%;top:${py}%">${m.n}</span>`;
    })
    .join("");
  const src = "data:image/png;base64," + fs.readFileSync(abs).toString("base64");
  return `<figure class="shot" style="width:${widthPct}%;margin-left:auto;margin-right:auto"><div class="shot-box" style="padding-top:${(crop.h / crop.w) * 100}%"><img src="${src}" style="width:${imgW}%;left:${left}%;top:${top}%" alt="">${dots}</div>${caption ? `<figcaption>${inline(caption)}</figcaption>` : ""}</figure>`;
}

function mdToHtml(md, chapterId) {
  const lines = md.replace(/\r/g, "").split("\n");
  const out = [];
  let list = null;
  let para = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`);
    para = [];
  };
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  let h1 = "";
  const sections = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushPara();
      closeList();
      continue;
    }
    let m;
    if ((m = line.match(/^# (.+)/))) {
      flushPara();
      closeList();
      h1 = m[1];
    } else if ((m = line.match(/^## (.+)/))) {
      flushPara();
      closeList();
      const id = `${chapterId}-${slug(m[1])}`;
      sections.push({ id, title: m[1] });
      out.push(`<h2 id="${id}">${inline(m[1])}</h2>`);
    } else if ((m = line.match(/^### (.+)/))) {
      flushPara();
      closeList();
      out.push(`<h3>${inline(m[1])}</h3>`);
    } else if (line.startsWith("@fig ")) {
      flushPara();
      closeList();
      out.push(figure(line, chapterId));
    } else if ((m = line.match(/^> ?(.*)/))) {
      flushPara();
      closeList();
      out.push(`<div class="note">${inline(m[1])}</div>`);
    } else if ((m = line.match(/^- (.+)/))) {
      flushPara();
      if (list !== "ul") {
        closeList();
        out.push("<ul>");
        list = "ul";
      }
      out.push(`<li>${inline(m[1])}</li>`);
    } else if ((m = line.match(/^\d+\. (.+)/))) {
      flushPara();
      if (list !== "ol") {
        closeList();
        out.push("<ol>");
        list = "ol";
      }
      out.push(`<li>${inline(m[1])}</li>`);
    } else {
      closeList();
      para.push(line.trim());
    }
  }
  flushPara();
  closeList();
  return { h1, sections, html: out.join("\n") };
}

function page(title, body) {
  const css = fs.readFileSync(path.join(SRC, "manual.css"), "utf8");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${css}</style></head><body>${body}</body></html>`;
}

function chapterHtml(ch, n) {
  const kicker = n ? `Capítulo ${n}` : "Módulo opcional";
  return `<section class="chapter" id="${ch.id}"><div class="chapter-kicker">${kicker}</div><h1>${inline(ch.h1)}</h1>${ch.html}</section>`;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const files = fs.readdirSync(SRC).filter((f) => /^\d\d-.+\.md$/.test(f)).sort();
  const all = files.map((f) => {
    const id = f.replace(/\.md$/, "");
    return { file: f, id, n: 0, ...mdToHtml(fs.readFileSync(path.join(SRC, f), "utf8"), id) };
  });
  // Manual general: todos los capitulos menos Mesas, numerados seguidos (1, 2, 3...).
  const chapters = all.filter((c) => c.id !== MESAS_ID).map((c, i) => ({ ...c, n: i + 1 }));
  const mesas = all.find((c) => c.id === MESAS_ID) || null;
  const version = require(path.join(ROOT, "package.json")).version;
  const stamp = new Date().toLocaleDateString("es-ES", { year: "numeric", month: "long" });
  const cover = (sub) =>
    `<section class="cover"><div class="cover-brand">Recipok</div><h1>Manual del TPV</h1><div class="cover-sub">${esc(sub)}</div><div class="cover-meta">Versión del programa ${esc(version)} · ${esc(stamp)}</div></section>`;
  const tocOf = (list, numbered) =>
    `<section class="toc"><h1>Índice</h1>${list
      .map(
        (c) =>
          `<div class="toc-ch"><a href="#${c.id}">${numbered ? `Capítulo ${c.n}. ` : ""}${inline(c.h1)}</a><ul>${c.sections.map((s) => `<li><a href="#${s.id}">${inline(s.title)}</a></li>`).join("")}</ul></div>`,
      )
      .join("")}</section>`;
  const toc = tocOf(chapters, true);

  const jobs = [];
  if (!filter) {
    jobs.push({
      name: "Manual-TPV-Recipok.pdf",
      html: page("Manual del TPV", cover("Guía de uso") + toc + chapters.map((c) => chapterHtml(c, c.n)).join("")),
    });
  }
  if (mesas && (!filter || mesas.file.startsWith(filter))) {
    jobs.push({
      name: "Manual-TPV-Recipok-Modo-Mesas.pdf",
      html: page("Manual del Modo Mesas", cover("Modo Mesas (módulo opcional)") + tocOf([mesas], false) + chapterHtml(mesas, 0)),
    });
  }
  for (const c of chapters) {
    if (filter && !c.file.startsWith(filter)) continue;
    const rest = c.id.replace(/^\d+-/, "");
    jobs.push({ name: `Manual-TPV-Recipok-${String(c.n).padStart(2, "0")}-${rest}.pdf`, html: page(c.h1, chapterHtml(c, c.n)) });
  }

  const app = await electron.launch({ args: [path.join(__dirname, "pdf-main.js")] });
  try {
    for (const j of jobs) {
      const tmp = path.join(OUT, "_tmp.html");
      fs.writeFileSync(tmp, j.html, "utf8");
      fs.writeFileSync(path.join(OUT, j.name.replace(/\.pdf$/, ".html")), j.html, "utf8"); // vista previa en navegador
      const b64 = await app.evaluate(async ({ BrowserWindow }, { tmp }) => {
        const win = new BrowserWindow({ show: false, webPreferences: { offscreen: false } });
        await win.loadFile(tmp);
        await new Promise((r) => setTimeout(r, 600));
        const buf = await win.webContents.printToPDF({
          pageSize: "A4",
          printBackground: true,
          displayHeaderFooter: true,
          headerTemplate: "<span></span>",
          footerTemplate:
            '<div style="width:100%;font-size:8px;color:#888;padding:0 18mm;display:flex;justify-content:space-between;font-family:Segoe UI,Arial,sans-serif"><span>Manual del TPV Recipok</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
          margins: { top: 0.7, bottom: 0.8, left: 0.7, right: 0.7 },
        });
        win.destroy();
        return buf.toString("base64");
      }, { tmp });
      try {
        fs.writeFileSync(path.join(OUT, j.name), Buffer.from(b64, "base64"));
      } catch (e) {
        if (e.code !== "EBUSY") throw e;
        // El PDF esta abierto en otro programa (visor): se guarda con otro nombre en vez de fallar.
        j.name = j.name.replace(/\.pdf$/, "-nuevo.pdf");
        fs.writeFileSync(path.join(OUT, j.name), Buffer.from(b64, "base64"));
      }
      console.log("OK", j.name);
    }
    fs.unlinkSync(path.join(OUT, "_tmp.html"));
  } finally {
    try {
      require("child_process").execSync(`taskkill /PID ${app.process().pid} /T /F`, { stdio: "ignore" });
    } catch {}
  }
  process.exit(0);
})().catch((e) => {
  console.error("ERROR", e);
  process.exit(1);
});
