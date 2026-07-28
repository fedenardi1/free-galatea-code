// FREE GALATEA CODE - agente di coding locale, in stile Claude Code, per QUALSIASI
// modello con API compatibile OpenAI (Moonshot, OpenRouter, Groq, Ollama, Together...).
// Zero dipendenze: gira col Node di sistema. I dati stanno in ~\.galatea-code\
//
// Cosa fa:
//  - sessioni separate per cartella di progetto (come i progetti di Claude Code)
//  - agente con strumenti veri sui file della cartella (leggi, scrivi, modifica, cerca)
//  - comandi PowerShell SOLO dietro conferma esplicita nell'interfaccia
//  - memoria persistente: globale + per progetto, che l'agente puo' aggiornare da solo
//  - contatore di spesa per sessione, per giorno e totale (prezzi configurabili)
//  - ANONIMIZZATORE: pseudonimizzazione reversibile in locale, ispirata all'approccio
//    mostrato da Simone Rizzo (Inferentia). I dati veri restano sul tuo disco, al
//    modello arrivano segnaposto tipo {{PERSONA_1}}; le risposte vengono ritradotte.
//  - trascrizione audio con Groq (se metti la chiave)

import { createServer } from "node:http";
import { readFile, writeFile, mkdir, readdir, stat, rename, rm } from "node:fs/promises";
import { existsSync, createWriteStream } from "node:fs";
import { spawn } from "node:child_process";
import { join, resolve, dirname, relative, basename } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";

const QUI = dirname(fileURLToPath(import.meta.url));
const PORTA = process.env.PORT || 4318;
const DATI = join(homedir(), ".galatea-code");
const DIR_SESSIONI = join(DATI, "sessioni");
const DIR_MEMORIA = join(DATI, "memoria");
const DIR_ANONIMI = join(DATI, "anonimi");
const FILE_CONSUMI = join(DATI, "consumi.json");

// difetti: Kimi K3 su Moonshot; dall'interfaccia puoi puntare qualunque endpoint
const API_DEFAULT = "https://api.moonshot.ai/v1";
const MODELLO_DEFAULT = "kimi-k3";
const PREZZI_DEFAULT = { inputMiss: 3.0, inputHit: 0.3, output: 15.0 }; // $/M token
const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const MAX_GIRI = 40;
const MAX_MESSAGGI = 80;

await mkdir(DIR_SESSIONI, { recursive: true });
await mkdir(DIR_MEMORIA, { recursive: true });
await mkdir(DIR_ANONIMI, { recursive: true });

/* ------------------------------------------------------------------ utilita */

const slug = (s) => createHash("sha1").update(String(s).toLowerCase()).digest("hex").slice(0, 12);

function json(res, codice, dati) {
  res.writeHead(codice, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(dati));
}
const err = (res, messaggio, codice = 400) => json(res, codice, { errore: messaggio });

async function corpoJSON(req) {
  const pezzi = [];
  for await (const p of req) pezzi.push(p);
  return JSON.parse(Buffer.concat(pezzi).toString("utf8") || "{}");
}

async function leggiJSON(percorso, difetto) {
  try { return JSON.parse(await readFile(percorso, "utf8")); } catch { return difetto; }
}
const salvaJSON = (percorso, dati) => writeFile(percorso, JSON.stringify(dati, null, 2), "utf8");

const oggiIT = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date());

/** Config del provider: header dell'interfaccia > chiavi salvate su disco > env.
    Le chiavi salvate (facoltative, servono alle attivita' schedulate) stanno in
    ~\.galatea-code\config.json e si scrivono SOLO dal pulsante nelle impostazioni. */
const FILE_CONFIG = join(DATI, "config.json");

async function configModello(req) {
  const salvata = await leggiJSON(FILE_CONFIG, {});
  let prezzi = { ...PREZZI_DEFAULT, ...(salvata.prezzi || {}) };
  try { prezzi = { ...prezzi, ...JSON.parse(req?.headers?.["x-prezzi"] || "{}") }; } catch {}
  return {
    chiave: req?.headers?.["x-api-key"] || salvata.api || process.env.GALATEA_API_KEY || process.env.MOONSHOT_API_KEY || "",
    base: String(req?.headers?.["x-base-url"] || salvata.base || API_DEFAULT).replace(/\/+$/, ""),
    modello: req?.headers?.["x-model"] || salvata.modello || MODELLO_DEFAULT,
    prezzi,
  };
}

/* ------------------------------------------------------------------ sessioni */

const fileSessione = (id) => join(DIR_SESSIONI, id + ".json");

async function elencaSessioni() {
  const voci = (await readdir(DIR_SESSIONI)).filter((f) => f.endsWith(".json"));
  const fuori = [];
  for (const v of voci) {
    const s = await leggiJSON(join(DIR_SESSIONI, v), null);
    if (s) fuori.push({ id: s.id, nome: s.nome, cartella: s.cartella, creato: s.creato, ultimoUso: s.ultimoUso, costo: s.costo || 0, nMessaggi: (s.eventi || []).length });
  }
  return fuori.sort((a, b) => (b.ultimoUso || 0) - (a.ultimoUso || 0));
}

/* ------------------------------------------------------------------- memoria */

const fileMemoriaProgetto = (cartella) => join(DIR_MEMORIA, slug(cartella) + ".md");
const FILE_MEMORIA_GLOBALE = join(DATI, "MEMORIA.md");

async function leggiMemoria(cartella) {
  let globale = "", progetto = "";
  try { globale = await readFile(FILE_MEMORIA_GLOBALE, "utf8"); } catch {}
  try { progetto = await readFile(fileMemoriaProgetto(cartella), "utf8"); } catch {}
  return { globale, progetto };
}

/* -------------------------------------------------------------- anonimizzatore */
/* Pseudonimizzazione reversibile per progetto. La mappa segnaposto->valore vero
   vive SOLO in locale (~\.galatea-code\anonimi\). Al modello arrivano i segnaposto;
   quando il modello scrive file o comandi, i segnaposto tornano valori veri. */

// le chat senza cartella condividono una mappa unica "__chat__"
const chiaveAnon = (cartella) => cartella || "__chat__";
const fileAnonimi = (cartella) => join(DIR_ANONIMI, slug(chiaveAnon(cartella)) + ".json");
const caricaAnonimi = (cartella) => leggiJSON(fileAnonimi(cartella), { mappa: {}, contatori: {} });

function segnaposto(stato, tipo, valore) {
  for (const [seg, val] of Object.entries(stato.mappa)) {
    if (val.toLowerCase() === String(valore).toLowerCase()) return seg;
  }
  stato.contatori[tipo] = (stato.contatori[tipo] || 0) + 1;
  const seg = `{{${tipo}_${stato.contatori[tipo]}}}`;
  stato.mappa[seg] = String(valore);
  return seg;
}

/* Se rizzo-pii (github.com/Rizzo-AI-Academy/rizzo-pii) gira in locale, usiamo il SUO
   motore ML per trovare i dati personali: 22 categorie, molto oltre le nostre regex.
   I suoi segnaposto per-chiamata vengono rinumerati nella nostra mappa stabile di
   progetto, cosi' restano reversibili tra un messaggio e l'altro. */
const RIZZO_URL_DEFAULT = "http://127.0.0.1:5005";

async function rizzoVivo(urlBase) {
  try {
    await fetch(urlBase + "/config", { signal: AbortSignal.timeout(1000) });
    return true;
  } catch { return false; }
}

async function anonimizzaConRizzo(urlBase, testo, stato) {
  const r = await fetch(urlBase + "/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: testo }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error("rizzo-pii " + r.status);
  const d = await r.json();
  let anon = d.anonymized_text ?? testo;
  for (const [suo, valore] of Object.entries(d.mapping || {})) {
    const tipo = suo.match(/^\[([A-Z_]+)_\d+\]$/)?.[1] || "DATO";
    const nostro = segnaposto(stato, tipo, valore);
    anon = anon.split(suo).join(nostro);
  }
  return anon;
}

/* L'anonimizzazione E' rizzo-pii: nessuna implementazione nostra di rilevazione.
   Se l'anonimizzatore e' acceso ma rizzo-pii non gira, ci si ferma con un errore
   chiaro invece di fingere una protezione che non c'e'. */
async function anonimizza(testo, stato, rizzoUrl) {
  if (!testo || !stato) return testo;
  if (!rizzoUrl) {
    throw new Error("Anonymizer is ON but rizzo-pii is not running on 127.0.0.1:5005. Start it, install it from github.com/Rizzo-AI-Academy/rizzo-pii, or turn the anonymizer off.");
  }
  return anonimizzaConRizzo(rizzoUrl, String(testo), stato);
}

function deanonimizza(testo, stato) {
  if (!testo || !stato) return testo;
  let t = String(testo);
  for (const [seg, val] of Object.entries(stato.mappa)) t = t.split(seg).join(val);
  return t;
}

/* ------------------------------------------------------------------- consumi */

async function registraConsumo(sessioneId, uso, prezzi) {
  const input = uso?.prompt_tokens || 0;
  const cache = Math.min(input, uso?.prompt_cache_hit_tokens ?? uso?.prompt_tokens_details?.cached_tokens ?? 0);
  const output = uso?.completion_tokens || 0;
  const costo = ((input - cache) / 1e6) * prezzi.inputMiss + (cache / 1e6) * prezzi.inputHit + (output / 1e6) * prezzi.output;

  const c = await leggiJSON(FILE_CONSUMI, { totale: 0, giorni: {}, sessioni: {} });
  c.totale += costo;
  const g = oggiIT();
  c.giorni[g] = (c.giorni[g] || 0) + costo;
  c.sessioni[sessioneId] = (c.sessioni[sessioneId] || 0) + costo;
  await salvaJSON(FILE_CONSUMI, c);
  return { costo, input, cache, output, totale: c.totale, oggi: c.giorni[g], sessione: c.sessioni[sessioneId] };
}

/* ------------------------------------------------- strumenti dentro la cartella */

function percorsoSicuro(cartella, p) {
  const abs = resolve(cartella, p || ".");
  const radice = resolve(cartella);
  if (abs !== radice && !abs.startsWith(radice + "\\") && !abs.startsWith(radice + "/")) {
    throw new Error(`Path outside the project folder: ${p}`);
  }
  return abs;
}

const IGNORA = new Set(["node_modules", ".git", ".wrangler", "__pycache__", "dist", "build", ".venv", "venv"]);

async function albero(base, dir, profondita, righe) {
  if (profondita > 4 || righe.length > 300) return;
  let voci;
  try { voci = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const v of voci.sort((a, b) => a.name.localeCompare(b.name))) {
    if (IGNORA.has(v.name)) continue;
    const rel = relative(base, join(dir, v.name));
    if (v.isDirectory()) { righe.push(rel + "\\"); await albero(base, join(dir, v.name), profondita + 1, righe); }
    else righe.push(rel);
  }
}

async function cercaTesto(base, dir, pattern, righe, profondita = 0) {
  if (profondita > 5 || righe.length >= 60) return;
  let voci;
  try { voci = await readdir(dir, { withFileTypes: true }); } catch { return; }
  const re = new RegExp(pattern, "i");
  for (const v of voci) {
    if (IGNORA.has(v.name)) continue;
    const pieno = join(dir, v.name);
    if (v.isDirectory()) { await cercaTesto(base, pieno, pattern, righe, profondita + 1); continue; }
    const s = await stat(pieno).catch(() => null);
    if (!s || s.size > 1_500_000) continue;
    let testo;
    try { testo = await readFile(pieno, "utf8"); } catch { continue; }
    if (testo.includes(" ")) continue;
    const ll = testo.split("\n");
    for (let i = 0; i < ll.length && righe.length < 60; i++) {
      if (re.test(ll[i])) righe.push(`${relative(base, pieno)}:${i + 1}: ${ll[i].trim().slice(0, 200)}`);
    }
  }
}

function eseguiComando(comando, cwd, segnale) {
  return new Promise((risolvi) => {
    const proc = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", comando], { cwd, signal: segnale });
    let fuori = "";
    const raccogli = (d) => { if (fuori.length < 30000) fuori += d.toString("utf8"); };
    proc.stdout.on("data", raccogli);
    proc.stderr.on("data", raccogli);
    const timer = setTimeout(() => proc.kill(), 120_000);
    proc.on("close", (codice) => { clearTimeout(timer); risolvi(`exit ${codice}\n${fuori.slice(0, 25000)}`); });
    proc.on("error", (e) => { clearTimeout(timer); risolvi(`failed to start: ${e.message}`); });
  });
}

/* ------------------------------------------------------- connettori MCP (stdio) */
/* Client MCP generico: i server si dichiarano in ~\.galatea-code\mcp.json
   ({"servers":{"nome":{"command":"...","args":[...],"env":{...}}}}) e i loro
   strumenti compaiono al modello come mcp__nome__tool. Ogni chiamata a un
   connettore passa dalla conferma dell'utente, come i comandi. */

const FILE_MCP = join(DATI, "mcp.json");
const serverMCP = new Map();     // nome -> stato
const mappaToolMCP = new Map();  // nome esposto -> { server, tool }

const nomeToolMCP = (srv, t) => `mcp__${srv}__${t}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);

async function avviaMCP() {
  for (const s of serverMCP.values()) { try { s.proc.kill(); } catch {} }
  serverMCP.clear(); mappaToolMCP.clear();
  const cfg = await leggiJSON(FILE_MCP, { servers: {} });
  for (const [nome, c] of Object.entries(cfg.servers || {})) {
    try {
      const proc = spawn(c.command, c.args || [], {
        env: { ...process.env, ...(c.env || {}) },
        stdio: ["pipe", "pipe", "pipe"],
        shell: process.platform === "win32", // per npx e simili
      });
      const stato = { proc, tools: [], attese: new Map(), buf: "", prossimoId: 1, errore: null };
      proc.stdout.on("data", (d) => {
        stato.buf += d.toString("utf8");
        let i;
        while ((i = stato.buf.indexOf("\n")) >= 0) {
          const riga = stato.buf.slice(0, i).trim(); stato.buf = stato.buf.slice(i + 1);
          if (!riga) continue;
          try {
            const m = JSON.parse(riga);
            if (m.id != null && stato.attese.has(m.id)) {
              const att = stato.attese.get(m.id); stato.attese.delete(m.id);
              m.error ? att.ko(new Error(m.error.message || "MCP error")) : att.ok(m.result);
            }
          } catch {}
        }
      });
      proc.stderr.on("data", () => {});
      proc.on("error", (e) => { stato.errore = e.message; });
      proc.on("close", () => { stato.errore = stato.errore || "process exited"; });
      stato.chiama = (metodo, params, timeout = 20_000) => new Promise((ok, ko) => {
        const id = stato.prossimoId++;
        stato.attese.set(id, { ok, ko });
        try { proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method: metodo, params }) + "\n"); }
        catch (e) { stato.attese.delete(id); return ko(e); }
        setTimeout(() => { if (stato.attese.has(id)) { stato.attese.delete(id); ko(new Error(`MCP timeout: ${metodo}`)); } }, timeout);
      });
      serverMCP.set(nome, stato);
      await stato.chiama("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "free-galatea-code", version: "1.0.0" } }, 30_000);
      try { proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n"); } catch {}
      const lista = await stato.chiama("tools/list", {});
      stato.tools = lista.tools || [];
      for (const t of stato.tools) mappaToolMCP.set(nomeToolMCP(nome, t.name), { server: nome, tool: t.name });
      console.log(`  MCP "${nome}": ${stato.tools.length} tool`);
    } catch (e) {
      const st = serverMCP.get(nome); if (st) st.errore = e.message;
      console.log(`  MCP "${nome}": errore - ${e.message}`);
    }
  }
}

function strumentiMCP() {
  const fuori = [];
  for (const [nome, st] of serverMCP) {
    if (st.errore) continue;
    for (const t of st.tools) {
      fuori.push({ type: "function", function: { name: nomeToolMCP(nome, t.name), description: `[MCP:${nome}] ${t.description || t.name}`, parameters: t.inputSchema || { type: "object" } } });
    }
  }
  return fuori;
}

async function chiamaToolMCP(nomeEsposto, args) {
  const rif = mappaToolMCP.get(nomeEsposto);
  if (!rif) return "ERROR: unknown MCP tool";
  const st = serverMCP.get(rif.server);
  if (!st || st.errore) return `ERROR: MCP server "${rif.server}": ${st?.errore || "not running"}`;
  const r = await st.chiama("tools/call", { name: rif.tool, arguments: args || {} }, 60_000);
  const testi = (r?.content || []).map((c) => (c.type === "text" ? c.text : `[${c.type}]`)).join("\n");
  return (r?.isError ? "ERROR: " : "") + (testi || JSON.stringify(r ?? {}));
}

/* --------------------------------------------------------- attivita' ricorrenti */
/* Schedulate dal server: girano anche a interfaccia chiusa (finche' l'app e' su).
   Servono le chiavi salvate su disco (config.json). I comandi PowerShell sono
   sempre NEGATI nelle esecuzioni schedulate; i connettori MCP solo se l'attivita'
   e' stata creata con l'autorizzazione esplicita. */

const FILE_ATTIVITA = join(DATI, "attivita.json");

function prossimaEsecuzione(cadenza, da = new Date()) {
  const d = new Date(da.getTime());
  if (cadenza.tipo === "ore") return da.getTime() + Math.max(1, cadenza.n) * 3_600_000;
  const [h, m] = String(cadenza.ora || "09:00").split(":").map(Number);
  d.setHours(h || 9, m || 0, 0, 0);
  if (cadenza.tipo === "giornaliera") {
    if (d <= da) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  // settimanale: 0=domenica ... 6=sabato
  const giorno = Number(cadenza.giorno ?? 1);
  while (d.getDay() !== giorno || d <= da) d.setDate(d.getDate() + 1);
  return d.getTime();
}

async function eseguiAttivita(att) {
  const sessione = await leggiJSON(fileSessione(att.sessioneId), null);
  if (!sessione) { att.attiva = false; att.ultimoEsito = "session no longer exists"; return; }
  if (inCorso.has(sessione.id)) { att.ultimoEsito = "skipped: session busy"; return; }
  const cfg = await configModello(null);
  if (!cfg.chiave) { att.ultimoEsito = "no saved API key: Settings > Save keys on this PC"; return; }
  const salvata = await leggiJSON(FILE_CONFIG, {});

  const controllore = new AbortController();
  inCorso.set(sessione.id, controllore);
  const timer = setTimeout(() => controllore.abort(), 15 * 60_000); // tetto 15 minuti
  try {
    await eseguiTurno({
      sessione, messaggioUtente: att.prompt, cfg,
      chiaveGroq: salvata.groq || process.env.GROQ_API_KEY || "",
      anonAttivo: !!att.anonimizza,
      rizzoBase: process.env.RIZZO_PII_URL || RIZZO_URL_DEFAULT,
      manda: () => {},                        // gli eventi finiscono comunque nella sessione
      chiediConferma: async () => false,      // niente comandi senza un umano davanti
      controllore, schedulata: true, autoMCP: !!att.autoMCP,
    });
    att.ultimoEsito = "ok";
  } catch (e) {
    att.ultimoEsito = "error: " + String(e.message || e).slice(0, 200);
  } finally {
    clearTimeout(timer);
    inCorso.delete(sessione.id);
  }
}

let schedulerAvviato = false;
function avviaScheduler() {
  if (schedulerAvviato) return;
  schedulerAvviato = true;
  setInterval(async () => {
    try {
      const dati = await leggiJSON(FILE_ATTIVITA, { attivita: [] });
      let cambiato = false;
      for (const att of dati.attivita) {
        if (!att.attiva || (att.prossima || 0) > Date.now()) continue;
        att.prossima = prossimaEsecuzione(att.cadenza);   // prima di eseguire: niente doppi giri
        att.ultimaEsecuzione = Date.now();
        cambiato = true;
        await salvaJSON(FILE_ATTIVITA, dati);
        await eseguiAttivita(att);
        await salvaJSON(FILE_ATTIVITA, dati);
      }
      if (cambiato) await salvaJSON(FILE_ATTIVITA, dati);
    } catch {}
  }, 30_000);
}

/* ------------------------------------------------- aggiornamento dall'ultima versione */

const REPO_TARBALL = "https://codeload.github.com/fedenardi1/free-galatea-code/tar.gz/refs/heads/master";
const REPO_COMMIT_API = "https://api.github.com/repos/fedenardi1/free-galatea-code/commits/master";

async function aggiornaGalatea() {
  // se e' un clone git, la via maestra e' git pull
  if (existsSync(join(QUI, ".git"))) {
    const esito = await eseguiComando("git pull", QUI);
    if (!/^exit 0/.test(esito)) throw new Error("git pull failed: " + esito.slice(0, 300));
    return "updated via git pull";
  }
  // installazione da zip: scarica il tarball e copia sopra (tar c'e' su Win10+, mac, linux)
  const tmp = join(DATI, "aggiornamento");
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  const r = await fetch(REPO_TARBALL, { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error("download failed: HTTP " + r.status);
  const tgz = join(tmp, "galatea.tgz");
  await writeFile(tgz, Buffer.from(await r.arrayBuffer()));
  const esito = await eseguiComando(`tar -xzf "${tgz}" -C "${tmp}"`, tmp);
  if (!/^exit 0/.test(esito)) throw new Error("extract failed: " + esito.slice(0, 300));
  const voci = (await readdir(tmp, { withFileTypes: true })).filter((v) => v.isDirectory());
  if (!voci.length) throw new Error("archive empty");
  const { cp } = await import("node:fs/promises");
  await cp(join(tmp, voci[0].name), QUI, { recursive: true, force: true });
  await writeFile(join(QUI, ".versione"), new Date().toISOString(), "utf8");
  await rm(tmp, { recursive: true, force: true });
  return "updated from the latest GitHub version";
}

/* ------------------------------------------------- attrezzarsi da soli (con approvazione) */
/* L'agente puo' CERCARE quello che gli manca sui registri pubblici affidabili e leggere
   le pagine di documentazione. L'INSTALLAZIONE resta un comando: passa sempre dalla
   conferma esplicita dell'utente, come ogni esegui_comando. */

async function cercaPacchetti(registro, query) {
  const q = encodeURIComponent(query);
  const prendi = async (u) => {
    const r = await fetch(u, { headers: { "user-agent": "free-galatea-code" }, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(`${u} -> HTTP ${r.status}`);
    return r.json();
  };
  switch (registro) {
    case "npm": {
      const d = await prendi(`https://registry.npmjs.org/-/v1/search?text=${q}&size=8`);
      return (d.objects || []).map((o) => `${o.package.name}@${o.package.version} | ${(o.downloads?.weekly || 0).toLocaleString("en")} dl/week | ${o.package.description || ""} | https://www.npmjs.com/package/${o.package.name}`).join("\n") || "no results";
    }
    case "pypi": {
      try {
        const d = await prendi(`https://pypi.org/pypi/${q}/json`);
        return `${d.info.name}==${d.info.version} | ${d.info.summary || ""} | ${d.info.package_url || ""}`;
      } catch {
        return `no exact PyPI package named "${query}"; PyPI has no search API, try registro=github with the same query to find the right package name`;
      }
    }
    case "github": {
      const d = await prendi(`https://api.github.com/search/repositories?q=${q}&sort=stars&per_page=8`);
      return (d.items || []).map((i) => `${i.full_name} (${i.stargazers_count} stars) | ${i.description || ""} | ${i.html_url}`).join("\n") || "no results";
    }
    case "huggingface": {
      const d = await prendi(`https://huggingface.co/api/models?search=${q}&limit=8&sort=downloads&direction=-1`);
      return (Array.isArray(d) ? d : []).map((m) => `${m.id} | ${(m.downloads || 0).toLocaleString("en")} downloads, ${m.likes || 0} likes | https://huggingface.co/${m.id}`).join("\n") || "no results";
    }
    default:
      return "unknown registry: use npm, pypi, github or huggingface. For system tools, run 'winget search <name>' via esegui_comando.";
  }
}

async function leggiUrl(u) {
  if (!/^https:\/\//i.test(u)) return "ERROR: https URLs only";
  const r = await fetch(u, { headers: { "user-agent": "free-galatea-code", accept: "text/plain, text/markdown, text/html, application/json" }, redirect: "follow", signal: AbortSignal.timeout(15_000) });
  const tipo = r.headers.get("content-type") || "";
  if (!/text|json|xml|markdown/i.test(tipo)) return `ERROR: content-type ${tipo} not supported (text pages only, no binaries)`;
  const testo = await r.text();
  return `HTTP ${r.status} ${tipo}\n\n${testo.slice(0, 80_000)}${testo.length > 80_000 ? "\n...(truncated)" : ""}`;
}

const STRUMENTI = [
  { type: "function", function: { name: "leggi_file", description: "Reads a text file from the project folder. Use da_riga/quante_righe for large files.", parameters: { type: "object", properties: { percorso: { type: "string" }, da_riga: { type: "integer" }, quante_righe: { type: "integer" } }, required: ["percorso"] } } },
  { type: "function", function: { name: "scrivi_file", description: "Creates or overwrites a file in the project folder (creates subfolders too).", parameters: { type: "object", properties: { percorso: { type: "string" }, contenuto: { type: "string" } }, required: ["percorso", "contenuto"] } } },
  { type: "function", function: { name: "modifica_file", description: "Replaces EXACTLY one occurrence of 'cerca' with 'sostituisci' in a file. 'cerca' must be unique in the file.", parameters: { type: "object", properties: { percorso: { type: "string" }, cerca: { type: "string" }, sostituisci: { type: "string" } }, required: ["percorso", "cerca", "sostituisci"] } } },
  { type: "function", function: { name: "elenca_cartella", description: "Lists files and subfolders of the project (max 4 levels).", parameters: { type: "object", properties: { percorso: { type: "string" } } } } },
  { type: "function", function: { name: "cerca_testo", description: "Searches a regex in the project's text files. Returns file:line for the first 60 matches.", parameters: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] } } },
  { type: "function", function: { name: "esegui_comando", description: "Runs a PowerShell command in the project folder. The user must APPROVE it in the UI before it runs: propose short commands and explain why in your text.", parameters: { type: "object", properties: { comando: { type: "string" } }, required: ["comando"] } } },
  { type: "function", function: { name: "salva_memoria", description: "Appends a note to persistent memory. ambito 'progetto' = this folder only, 'globale' = all sessions. Use it for stable user preferences and durable project facts, not for current work.", parameters: { type: "object", properties: { testo: { type: "string" }, ambito: { type: "string", enum: ["progetto", "globale"] } }, required: ["testo"] } } },
  { type: "function", function: { name: "trascrivi_audio", description: "Transcribes an audio file from the folder with Groq Whisper (needs the Groq key, max 25 MB).", parameters: { type: "object", properties: { percorso: { type: "string" } }, required: ["percorso"] } } },
  { type: "function", function: { name: "cerca_pacchetti", description: "Searches trusted public registries for packages/models you may need: npm, pypi, github, huggingface. Returns names, popularity and links. Use it BEFORE proposing an install.", parameters: { type: "object", properties: { registro: { type: "string", enum: ["npm", "pypi", "github", "huggingface"] }, query: { type: "string" } }, required: ["registro", "query"] } } },
  { type: "function", function: { name: "leggi_url", description: "Fetches a public https page as text (docs, READMEs, registry pages). 80KB max, no binaries. Use it to check a package before installing it.", parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } } },
];

async function usaStrumento(nome, args, ctx) {
  const { cartella, chiaveGroq, chiediConferma, anon } = ctx;
  // quello che il modello manda puo' contenere segnaposto: sui file e nei comandi
  // devono tornare i valori veri, perche' il disco e' tuo, non del modello
  const vero = (t) => (anon ? deanonimizza(t, anon) : t);
  // quello che torna al modello va invece ri-anonimizzato (Promise: il chiamante attende)
  const mascherato = (t) => (anon ? anonimizza(t, anon, ctx.rizzoUrl) : t);

  switch (nome) {
    case "leggi_file": {
      const p = percorsoSicuro(cartella, args.percorso);
      const testo = await readFile(p, "utf8");
      const righe = testo.split("\n");
      const da = Math.max(0, (args.da_riga || 1) - 1);
      const quante = Math.min(args.quante_righe || 1500, 3000);
      const fetta = righe.slice(da, da + quante);
      const fuori = fetta.map((r, i) => `${da + i + 1}\t${r}`).join("\n").slice(0, 120_000) + (righe.length > da + quante ? `\n... (${righe.length} righe totali)` : "");
      return mascherato(fuori);
    }
    case "scrivi_file": {
      const p = percorsoSicuro(cartella, args.percorso);
      await mkdir(dirname(p), { recursive: true });
      const contenuto = vero(args.contenuto);
      await writeFile(p, contenuto, "utf8");
      return `wrote ${args.percorso} (${contenuto.length} chars)`;
    }
    case "modifica_file": {
      const p = percorsoSicuro(cartella, args.percorso);
      const testo = await readFile(p, "utf8");
      const cerca = vero(args.cerca), sostituisci = vero(args.sostituisci);
      const n = testo.split(cerca).length - 1;
      if (n === 0) return "ERROR: search text not found in file";
      if (n > 1) return `ERROR: search text appears ${n} times, it must be unique`;
      await writeFile(p, testo.replace(cerca, sostituisci), "utf8");
      return "edit applied";
    }
    case "elenca_cartella": {
      const p = percorsoSicuro(cartella, args.percorso || ".");
      const righe = [];
      await albero(p, p, 0, righe);
      return mascherato(righe.join("\n") || "(empty)");
    }
    case "cerca_testo": {
      const righe = [];
      await cercaTesto(cartella, cartella, vero(args.pattern), righe);
      return mascherato(righe.join("\n") || "no results");
    }
    case "esegui_comando": {
      const comandoVero = vero(args.comando);
      // automiglioramento: mai push verso il repo originale dell'autrice.
      // I fork sono benvenuti: li' il push resta possibile (con approvazione).
      if (/\bgit\b[^\n]*\bpush\b/i.test(comandoVero) && resolve(cartella).toLowerCase() === resolve(QUI).toLowerCase()) {
        const origine = await eseguiComando("git config --get remote.origin.url", cartella, ctx.segnale);
        if (/fedenardi1\/free-galatea-code/i.test(origine)) {
          return "BLOCKED: self-improvement sessions work locally only. Pushing to the original author's repository is disabled by design. Fork the project and push to your own fork instead.";
        }
      }
      const ok = await chiediConferma(comandoVero);
      if (!ok) return "The user DENIED this command. Do not retry the same command: ask what they prefer.";
      return mascherato(await eseguiComando(comandoVero, cartella, ctx.segnale));
    }
    case "salva_memoria": {
      const dest = args.ambito === "globale" ? FILE_MEMORIA_GLOBALE : fileMemoriaProgetto(cartella);
      const prima = existsSync(dest) ? await readFile(dest, "utf8") : "";
      await writeFile(dest, prima + (prima ? "\n" : "") + `- ${vero(args.testo)}  _( ${oggiIT()} )_`, "utf8");
      return "memory updated";
    }
    case "trascrivi_audio": {
      if (!chiaveGroq) return "ERROR: Groq key missing in settings";
      const p = percorsoSicuro(cartella, args.percorso);
      const buf = await readFile(p);
      if (buf.length > 25 * 1024 * 1024) return "ERROR: file over 25 MB, Groq's limit";
      const modulo = new FormData();
      modulo.append("file", new Blob([buf]), args.percorso.split(/[\\/]/).pop());
      modulo.append("model", "whisper-large-v3-turbo");
      modulo.append("language", "it");
      modulo.append("response_format", "text");
      const r = await fetch(GROQ_URL, { method: "POST", headers: { authorization: `Bearer ${chiaveGroq}` }, body: modulo });
      const testo = await r.text();
      return r.ok ? mascherato(testo.slice(0, 100_000)) : `ERROR Groq ${r.status}: ${testo.slice(0, 300)}`;
    }
    case "cerca_pacchetti": {
      // niente vero(): nelle query verso internet i segnaposto NON vanno tradotti,
      // cosi' i dati personali non possono uscire nemmeno per sbaglio
      try { return await cercaPacchetti(args.registro, String(args.query || "")); }
      catch (e) { return `ERROR: ${e.message}`; }
    }
    case "leggi_url": {
      try { return await leggiUrl(String(args.url || "")); }
      catch (e) { return `ERROR: ${e.message}`; }
    }
    default:
      // connettori MCP: ogni chiamata passa dalla conferma, come i comandi,
      // salvo attivita' schedulate create con l'autorizzazione esplicita
      if (nome.startsWith("mcp__")) {
        if (!ctx.autoMCP) {
          const ok = await chiediConferma(`[MCP connector] ${nome}\n${JSON.stringify(args || {}, null, 2).slice(0, 500)}`);
          if (!ok) return ctx.schedulata
            ? "DENIED: scheduled runs cannot use connectors unless the task was created with connector permission."
            : "The user DENIED this connector call.";
        }
        return chiamaToolMCP(nome, args);
      }
      return `unknown tool: ${nome}`;
  }
}

/* -------------------------------------------------------------- prompt sistema */

async function promptSistema(cartella, anonAttivo) {
  const { globale, progetto } = await leggiMemoria(cartella || "");

  const notaAnonChat = anonAttivo ? `

## Anonymizer active
Personal data is pseudonymized with placeholders like {{PERSONA_1}}. Treat them as proper nouns and REPEAT THEM VERBATIM: they are replaced with the real values locally. Never try to guess the real values.` : "";

  // chat pura, senza cartella: niente strumenti, solo conversazione
  if (!cartella) {
    return `You are Galatea (Free Galatea Code), a helpful assistant running locally on the user's computer.
Date: ${oggiIT()}

Rules:
- Reply in the user's language. Be concise and concrete. Never use em dashes.
- This is a plain chat with no project folder: you have no file tools here. If the user asks you to create, read or edit files, explain that chats have no tools by design, and that they should create a session on a folder (left sidebar, folder icon then "New session"): there you get full file tools, limited to that folder.${notaAnonChat}

## Global memory
${globale || "(empty)"}`;
  }

  let istruzioniProgetto = "";
  for (const nome of ["GALATEA.md", "KIMI.md", "CLAUDE.md"]) {
    try { istruzioniProgetto = `\n\n## Istruzioni del progetto (${nome})\n${await readFile(join(cartella, nome), "utf8")}`; break; } catch {}
  }

  // sessione di automiglioramento: sta lavorando su se stessa
  if (resolve(cartella).toLowerCase() === resolve(QUI).toLowerCase()) {
    istruzioniProgetto += `

## Self-improvement mode: you are editing YOUR OWN source code
This folder is Free Galatea Code itself, the app you are running inside. Architecture: server.mjs is a zero-dependency Node http server (agent loop, tools, sessions, anonymizer bridge to rizzo-pii, spend tracking); public/index.html is the entire UI, vanilla JS, no frameworks.
Hard rules:
- Keep ZERO runtime dependencies and the current file structure.
- Keep the basicfede look: cream #fef4e5, off-white #fcfcfc, ink #323131, lilac #e7ccef, lime #cfdc5b, blue #2e91fc, 2px ink borders, solid offset shadows, Fraunces for headings, IBM Plex Mono for body.
- NEVER remove or weaken the command approval gate, the folder sandbox, or the anonymizer.
- Never touch ~/.galatea-code (user data lives there, outside this repo).
- After editing server.mjs, always run "node --check server.mjs" via esegui_comando. UI changes go live when the user reloads the page; server.mjs changes require restarting the app (tell the user: close and relaunch avvia.cmd).
- WORK LOCALLY ONLY: never run git commit or git push unless the user explicitly asks. Pushing to the original author's repository is blocked at code level; contributions go through the user's own fork.
- Explain what you changed and how to see it.`;
  }
  const notaAnon = anonAttivo ? `

## Anonymizer active
Personal data in this session is pseudonymized: you will see placeholders like {{PERSONA_1}}, {{EMAIL_2}}, {{TELEFONO_1}}. They are opaque identifiers: treat them as proper nouns and REPEAT THEM VERBATIM, character by character, wherever needed. They are replaced with the real values locally, on the user's computer. Never try to guess the real values and never alter a placeholder.` : "";

  return `You are Galatea (Free Galatea Code), a coding agent working LOCALLY on the user's computer (Windows, PowerShell).
Project folder: ${cartella}
Date: ${oggiIT()}

Rules:
- Reply in the user's language. Be concise and concrete. Never use em dashes.
- Use the tools to look at files BEFORE talking about them: never invent contents you have not read.
- Paths are always relative to the project folder. You cannot leave it.
- Use modifica_file for small edits, scrivi_file for new files or rewrites.
- Commands (esegui_comando) only run if the user approves them: propose them one at a time and explain what they are for.
- When you learn a stable user preference or a durable fact about the project, save it with salva_memoria.
- Attachments: when the user attaches a file it is saved inside the project under allegati/ and the message contains a marker like [attached file: allegati/name.ext]. Go read or process that exact path with your tools (leggi_file for text, trascrivi_audio for audio, or equip yourself for other formats). Attached IMAGES also arrive inside the message as actual images: look at them directly, do not try to read image files with leggi_file.
- EQUIP YOURSELF: if the task needs a capability you do not have (open a PDF, read an image, OCR, convert media...), do not just refuse. Search for a reputable package with cerca_pacchetti (npm, pypi, github, huggingface), check it with leggi_url if useful, then propose the install via esegui_comando (npm install, pip install, winget install). Prefer widely used, actively maintained projects and say in one line why you picked that one. Installs ALWAYS need the user's approval, and after installing verify it works with a quick command.
- When you finish a piece of work, summarize in a few lines what you touched.${notaAnon}${istruzioniProgetto}

## Global memory
${globale || "(empty)"}

## Memory for this project
${progetto || "(empty)"}`;
}

/* --------------------------------------------------------------- giro agente */

const attese = new Map();
const inCorso = new Map();

/**
 * Nucleo del turno agente, condiviso tra la chat interattiva e le attivita'
 * schedulate. `manda` e' il canale eventi (SSE dal vivo, muto se schedulato);
 * `chiediConferma` decide comandi e connettori MCP (UI dal vivo, negato se schedulato).
 */
async function eseguiTurno({ sessione, messaggioUtente, cfg, chiaveGroq, anonAttivo, rizzoBase, manda, chiediConferma, controllore, schedulata = false, autoMCP = false }) {
  const anon = anonAttivo ? await caricaAnonimi(sessione.cartella) : null;
  const usaRizzo = anon ? await rizzoVivo(rizzoBase) : false;
  const rizzoUrl = usaRizzo ? rizzoBase : null;
  if (anonAttivo && !usaRizzo) {
    manda({ t: "errore", v: "Anonymizer is ON but rizzo-pii is not running on 127.0.0.1:5005. Start it, install it from github.com/Rizzo-AI-Academy/rizzo-pii, or turn the anonymizer off. Nothing was sent." });
    return;
  }

  const eventiNuovi = [{ t: "utente", v: (schedulata ? "⏰ [scheduled] " : "") + messaggioUtente, ts: Date.now() }];
  const perModello = anon ? await anonimizza(messaggioUtente, anon, rizzoUrl) : messaggioUtente;
  if (anon) {
    manda({ t: "anon", v: `${Object.keys(anon.mappa).length} values masked - engine: rizzo-pii (local)` });
  }

  /* Allegati immagine: se il messaggio cita [attached file: ...png/jpg/...] li
     leggiamo dalla cartella e li mandiamo al modello COME IMMAGINI (contenuto
     multimodale OpenAI). Kimi K3 ha la visione nativa; altri modelli visivi pure. */
  let contenutoUtente = perModello;
  if (sessione.cartella) {
    const IMG = /\.(png|jpe?g|gif|webp|bmp)$/i;
    const citati = [...messaggioUtente.matchAll(/\[attached (?:file|image):\s*([^\]]+)\]/gi)]
      .map((m) => m[1].trim()).filter((rel) => IMG.test(rel));
    const parti = [];
    for (const rel of citati.slice(0, 4)) {
      try {
        const buf = await readFile(percorsoSicuro(sessione.cartella, rel));
        if (buf.length > 10 * 1024 * 1024) { manda({ t: "errore", v: `${rel}: image over 10 MB, skipped` }); continue; }
        const ext = rel.toLowerCase();
        const mime = ext.endsWith(".png") ? "image/png" : ext.endsWith(".gif") ? "image/gif" : ext.endsWith(".webp") ? "image/webp" : ext.endsWith(".bmp") ? "image/bmp" : "image/jpeg";
        parti.push({ type: "image_url", image_url: { url: `data:${mime};base64,${buf.toString("base64")}` } });
      } catch (e) { manda({ t: "errore", v: `${rel}: ${e.message}` }); }
    }
    if (parti.length) {
      contenutoUtente = [{ type: "text", text: perModello }, ...parti];
      manda({ t: "anon", v: `${parti.length} image(s) attached to the message` });
      if (anon) manda({ t: "errore", v: "note: the anonymizer works on text, images are sent as-is (pixels are not masked)" });
    }
  }
  sessione.messaggi.push({ role: "user", content: contenutoUtente });

  const ctx = {
    cartella: sessione.cartella,
    chiaveGroq,
    anon,
    rizzoUrl,
    autoMCP,
    schedulata,
    segnale: controllore.signal,
    chiediConferma,
  };

  try {
    for (let giro = 0; giro < MAX_GIRI; giro++) {
      const messaggi = [{ role: "system", content: await promptSistema(sessione.cartella, anonAttivo) },
        ...sessione.messaggi.slice(-MAX_MESSAGGI)];

      // cartella = tutti gli strumenti; chat pura = solo i connettori MCP (se ci sono)
      const corpo = { model: cfg.modello, stream: true, stream_options: { include_usage: true }, messages: messaggi };
      const attrezzi = sessione.cartella ? [...STRUMENTI, ...strumentiMCP()] : strumentiMCP();
      if (attrezzi.length) corpo.tools = attrezzi;

      const r = await fetch(`${cfg.base}/chat/completions`, {
        method: "POST",
        signal: controllore.signal,
        headers: { authorization: `Bearer ${cfg.chiave}`, "content-type": "application/json" },
        body: JSON.stringify(corpo),
      });
      if (!r.ok) { const t = await r.text(); manda({ t: "errore", v: `API ${r.status}: ${t.slice(0, 500)}` }); break; }

      let testo = "", uso = null, fine = null;
      const chiamate = [];
      const dec = new TextDecoder(); let resto = "";
      for await (const pezzo of r.body) {
        resto += dec.decode(pezzo, { stream: true });
        const righe = resto.split("\n"); resto = righe.pop();
        for (const riga of righe) {
          if (!riga.startsWith("data:")) continue;
          const carico = riga.slice(5).trim();
          if (!carico || carico === "[DONE]") continue;
          let ev; try { ev = JSON.parse(carico); } catch { continue; }
          if (ev.usage) uso = ev.usage;
          const scelta = ev.choices?.[0];
          if (!scelta) continue;
          if (scelta.finish_reason) fine = scelta.finish_reason;
          const d = scelta.delta || {};
          if (d.reasoning_content) manda({ t: "pensiero", v: d.reasoning_content });
          if (d.content) { testo += d.content; manda({ t: "testo", v: d.content }); }
          for (const tc of d.tool_calls || []) {
            const i = tc.index ?? 0;
            chiamate[i] = chiamate[i] || { id: tc.id || randomUUID(), function: { name: "", arguments: "" }, type: "function" };
            if (tc.id) chiamate[i].id = tc.id;
            if (tc.function?.name) chiamate[i].function.name += tc.function.name;
            if (tc.function?.arguments) chiamate[i].function.arguments += tc.function.arguments;
          }
        }
      }

      if (uso) {
        const c = await registraConsumo(sessione.id, uso, cfg.prezzi);
        sessione.costo = c.sessione;
        manda({ t: "uso", ...c });
      }
      if (testo) {
        // al modello restano i segnaposto, a te arriva il testo coi valori veri
        const inChiaro = anon ? deanonimizza(testo, anon) : testo;
        if (anon && inChiaro !== testo) manda({ t: "testo_pieno", v: inChiaro });
        eventiNuovi.push({ t: "assistente", v: inChiaro, ts: Date.now() });
      }

      const vive = chiamate.filter(Boolean);
      if (!vive.length || fine === "stop") {
        sessione.messaggi.push({ role: "assistant", content: testo || "" });
        break;
      }

      sessione.messaggi.push({ role: "assistant", content: testo || null, tool_calls: vive });
      for (const tc of vive) {
        let args = {};
        try { args = JSON.parse(tc.function.arguments || "{}"); } catch {}
        manda({ t: "tool", nome: tc.function.name, input: args });
        let esito;
        try { esito = await usaStrumento(tc.function.name, args, ctx); }
        catch (e) { esito = `ERROR: ${e.message}`; }
        manda({ t: "tool_fine", nome: tc.function.name, output: String(esito).slice(0, 4000) });
        eventiNuovi.push({ t: "tool", nome: tc.function.name, input: args, output: String(esito).slice(0, 4000), ts: Date.now() });
        sessione.messaggi.push({ role: "tool", tool_call_id: tc.id, content: String(esito).slice(0, 60_000) });
      }
    }
  } catch (e) {
    if (e.name !== "AbortError") manda({ t: "errore", v: String(e.message || e) });
    else manda({ t: "errore", v: "stopped by user" });
  } finally {
    if (anon) await salvaJSON(fileAnonimi(sessione.cartella), anon);
    sessione.eventi.push(...eventiNuovi);
    sessione.ultimoUso = Date.now();
    await salvaJSON(fileSessione(sessione.id), sessione);
  }
}

/** Chat interattiva: eventi via SSE, conferme via interfaccia. */
async function giroAgente(req, res, sessione, messaggioUtente) {
  const cfg = await configModello(req);
  const salvata = await leggiJSON(FILE_CONFIG, {});
  const chiaveGroq = req.headers["x-groq-key"] || salvata.groq || process.env.GROQ_API_KEY || "";
  if (!cfg.chiave) { json(res, 400, { errore: "Missing API key: set it in Settings (gear icon)." }); return; }

  res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache" });
  const manda = (ev) => { try { res.write(`data: ${JSON.stringify(ev)}\n\n`); } catch {} };
  const controllore = new AbortController();
  inCorso.set(sessione.id, controllore);

  const chiediConferma = (comando) => new Promise((risolvi) => {
    const id = randomUUID();
    attese.set(id, risolvi);
    manda({ t: "conferma", id, comando });
    setTimeout(() => { if (attese.has(id)) { attese.delete(id); risolvi(false); } }, 300_000);
  });

  try {
    await eseguiTurno({
      sessione, messaggioUtente, cfg, chiaveGroq,
      anonAttivo: req.headers["x-anonimizza"] === "1",
      rizzoBase: req.headers["x-rizzo-url"] || process.env.RIZZO_PII_URL || RIZZO_URL_DEFAULT,
      manda, chiediConferma, controllore,
    });
  } finally {
    inCorso.delete(sessione.id);
    manda({ t: "fine" });
    res.end();
  }
}

/* -------------------------------------------------------------------- routing */

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORTA}`);
  const p = url.pathname;

  try {
    if (p === "/" || p === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(await readFile(join(QUI, "public", "index.html")));
    }

    if (p === "/api/sessioni" && req.method === "GET") return json(res, 200, { sessioni: await elencaSessioni() });

    if (p === "/api/sessioni" && req.method === "POST") {
      const { cartella, nome, chat, galatea } = await corpoJSON(req);

      // automiglioramento: sessione sul codice sorgente di Galatea stessa
      if (galatea) {
        const esistenti = await elencaSessioni();
        const gia = esistenti.find((s) => s.cartella && resolve(s.cartella).toLowerCase() === resolve(QUI).toLowerCase());
        if (gia) return json(res, 200, { sessione: { id: gia.id, nome: gia.nome, cartella: gia.cartella } });
        const sessione = { id: randomUUID(), nome: "✨ Galatea herself", cartella: resolve(QUI), creato: Date.now(), ultimoUso: Date.now(), costo: 0, messaggi: [], eventi: [] };
        await salvaJSON(fileSessione(sessione.id), sessione);
        return json(res, 200, { sessione: { id: sessione.id, nome: sessione.nome, cartella: sessione.cartella } });
      }

      // chat pura: nessuna cartella, nessuno strumento
      if (chat) {
        const sessione = { id: randomUUID(), nome: nome || `Chat ${new Date().toLocaleDateString("en-GB")}`, cartella: null, creato: Date.now(), ultimoUso: Date.now(), costo: 0, messaggi: [], eventi: [] };
        await salvaJSON(fileSessione(sessione.id), sessione);
        return json(res, 200, { sessione: { id: sessione.id, nome: sessione.nome, cartella: null } });
      }

      // Windows "copia come percorso" incolla le virgolette attorno: via
      const abs = resolve(String(cartella || "").trim().replace(/^"+|"+$/g, ""));
      if (!existsSync(abs)) return err(res, `Folder does not exist: ${abs}`);
      const s = await stat(abs);
      if (!s.isDirectory()) return err(res, "Path is not a folder");
      const sessione = { id: randomUUID(), nome: nome || abs.split(/[\\/]/).pop(), cartella: abs, creato: Date.now(), ultimoUso: Date.now(), costo: 0, messaggi: [], eventi: [] };
      await salvaJSON(fileSessione(sessione.id), sessione);
      return json(res, 200, { sessione: { id: sessione.id, nome: sessione.nome, cartella: abs } });
    }

    const mSess = p.match(/^\/api\/sessioni\/([\w-]+)$/);
    if (mSess && req.method === "GET") {
      const s = await leggiJSON(fileSessione(mSess[1]), null);
      if (!s) return err(res, "session not found", 404);
      return json(res, 200, { id: s.id, nome: s.nome, cartella: s.cartella, eventi: s.eventi, costo: s.costo || 0, occupata: inCorso.has(s.id) });
    }
    if (mSess && req.method === "DELETE") {
      const f = fileSessione(mSess[1]);
      if (existsSync(f)) await rename(f, f + ".cestino");
      return json(res, 200, { ok: true });
    }

    if (p === "/api/chat" && req.method === "POST") {
      const { sessioneId, messaggio } = await corpoJSON(req);
      const sessione = await leggiJSON(fileSessione(sessioneId), null);
      if (!sessione) return err(res, "session not found", 404);
      if (inCorso.has(sessioneId)) return err(res, "this session is already working: wait or press Stop", 409);
      if (!messaggio?.trim()) return err(res, "empty message");
      return giroAgente(req, res, sessione, messaggio.trim());
    }

    if (p === "/api/stop" && req.method === "POST") {
      const { sessioneId } = await corpoJSON(req);
      inCorso.get(sessioneId)?.abort();
      return json(res, 200, { ok: true });
    }

    if (p === "/api/conferma" && req.method === "POST") {
      const { id, approvato } = await corpoJSON(req);
      const risolvi = attese.get(id);
      if (!risolvi) return err(res, "request expired or already decided", 404);
      attese.delete(id);
      risolvi(!!approvato);
      return json(res, 200, { ok: true });
    }

    /* Allegati: il file viene caricato come corpo grezzo (niente multipart) e
       salvato in <cartella>/allegati/, poi il messaggio cita il percorso e
       l'agente se lo va a prendere con i suoi strumenti. Nelle chat senza
       cartella si accettano solo file di testo piccoli, restituiti inline. */
    if (p === "/api/allegati" && req.method === "POST") {
      const sessione = await leggiJSON(fileSessione(url.searchParams.get("sessioneId") || ""), null);
      if (!sessione) return err(res, "session not found", 404);
      const nomeGrezzo = decodeURIComponent(url.searchParams.get("nome") || "file");
      const nome = (nomeGrezzo.replace(/[\\\/:*?"<>|]/g, "_").trim() || "file").slice(-120);

      if (!sessione.cartella) {
        const pezzi = []; let tot = 0;
        for await (const c of req) {
          tot += c.length;
          if (tot > 300_000) return err(res, "Plain chats can only inline small text files (under 300 KB). For audio, video or big files, open a folder session.", 413);
          pezzi.push(c);
        }
        const buf = Buffer.concat(pezzi);
        if (buf.includes(0)) return err(res, "This looks like a binary file. Plain chats have no file tools: open a folder session to work with media.", 415);
        return json(res, 200, { inline: buf.toString("utf8"), nome });
      }

      const dir = join(sessione.cartella, "allegati");
      await mkdir(dir, { recursive: true });
      let dest = join(dir, nome);
      for (let i = 1; existsSync(dest); i++) {
        const punto = nome.lastIndexOf(".");
        dest = join(dir, punto > 0 ? `${nome.slice(0, punto)}-${i}${nome.slice(punto)}` : `${nome}-${i}`);
      }
      const MAX = 500 * 1024 * 1024;
      let tot = 0;
      const ws = createWriteStream(dest);
      try {
        for await (const c of req) {
          tot += c.length;
          if (tot > MAX) throw new Error("File over 500 MB");
          if (!ws.write(c)) await new Promise((r) => ws.once("drain", r));
        }
        await new Promise((r, j) => { ws.on("error", j); ws.end(r); });
      } catch (e) {
        try { ws.destroy(); await rm(dest, { force: true }); } catch {}
        return err(res, String(e.message || e), 413);
      }
      return json(res, 200, { percorso: "allegati/" + basename(dest), nome: basename(dest), byte: tot });
    }

    /* sfoglia le cartelle del disco, per il selettore nell'interfaccia */
    if (p === "/api/cartelle" && req.method === "GET") {
      const richiesto = String(url.searchParams.get("path") || homedir()).trim().replace(/^"+|"+$/g, "");
      const abs = resolve(richiesto);
      let sotto = [];
      try {
        sotto = (await readdir(abs, { withFileTypes: true }))
          .filter((v) => v.isDirectory() && !v.name.startsWith(".") && !["node_modules", "$RECYCLE.BIN", "System Volume Information"].includes(v.name))
          .map((v) => v.name)
          .sort((a, b) => a.localeCompare(b));
      } catch (e) {
        return err(res, "Cannot open folder: " + e.message);
      }
      const casa = homedir();
      return json(res, 200, {
        path: abs,
        padre: dirname(abs),
        cartelle: sotto,
        scorciatoie: [
          { nome: "Home", path: casa },
          { nome: "Desktop", path: join(casa, "Desktop") },
          { nome: "Documents", path: join(casa, "Documents") },
          { nome: "Downloads", path: join(casa, "Downloads") },
        ].filter((s) => existsSync(s.path)),
      });
    }

    if (p === "/api/spesa" && req.method === "GET") {
      const c = await leggiJSON(FILE_CONSUMI, { totale: 0, giorni: {}, sessioni: {} });
      return json(res, 200, { totale: c.totale, oggi: c.giorni[oggiIT()] || 0, giorni: c.giorni });
    }

    if (p === "/api/memoria" && req.method === "GET") {
      return json(res, 200, await leggiMemoria(url.searchParams.get("cartella") || ""));
    }
    if (p === "/api/memoria" && req.method === "POST") {
      const { cartella, ambito, testo } = await corpoJSON(req);
      const dest = ambito === "globale" ? FILE_MEMORIA_GLOBALE : fileMemoriaProgetto(cartella);
      await writeFile(dest, testo ?? "", "utf8");
      return json(res, 200, { ok: true });
    }

    /* stato dell'anonimizzatore: rizzo-pii raggiungibile? quanti valori in mappa? */
    if (p === "/api/anonimi" && req.method === "GET") {
      const stato = await caricaAnonimi(url.searchParams.get("cartella") || "");
      const base = process.env.RIZZO_PII_URL || RIZZO_URL_DEFAULT;
      return json(res, 200, { mascherati: Object.keys(stato.mappa).length, rizzo: await rizzoVivo(base), rizzoUrl: base });
    }

    /* --- chiavi salvate su disco (servono alle attivita' schedulate) --- */
    if (p === "/api/config" && req.method === "GET") {
      const c = await leggiJSON(FILE_CONFIG, {});
      return json(res, 200, { salvate: !!c.api, base: c.base || null, modello: c.modello || null, groq: !!c.groq });
    }
    if (p === "/api/config" && req.method === "POST") {
      const { api, groq, base, modello, prezzi } = await corpoJSON(req);
      await salvaJSON(FILE_CONFIG, { api: api || "", groq: groq || "", base: base || "", modello: modello || "", prezzi: prezzi || null });
      return json(res, 200, { ok: true });
    }
    if (p === "/api/config" && req.method === "DELETE") {
      await rm(FILE_CONFIG, { force: true });
      return json(res, 200, { ok: true });
    }

    /* --- attivita' ricorrenti --- */
    if (p === "/api/attivita" && req.method === "GET") {
      const dati = await leggiJSON(FILE_ATTIVITA, { attivita: [] });
      const sessioni = await elencaSessioni();
      const nomi = Object.fromEntries(sessioni.map((s) => [s.id, s.nome]));
      return json(res, 200, { attivita: dati.attivita.map((a) => ({ ...a, sessioneNome: nomi[a.sessioneId] || "(deleted)" })) });
    }
    if (p === "/api/attivita" && req.method === "POST") {
      const { sessioneId, prompt, cadenza, autoMCP, anonimizza } = await corpoJSON(req);
      if (!sessioneId || !prompt?.trim() || !cadenza?.tipo) return err(res, "sessioneId, prompt and cadenza are required");
      const dati = await leggiJSON(FILE_ATTIVITA, { attivita: [] });
      const att = { id: randomUUID(), sessioneId, prompt: prompt.trim(), cadenza, autoMCP: !!autoMCP, anonimizza: !!anonimizza, attiva: true, creato: Date.now(), prossima: prossimaEsecuzione(cadenza), ultimoEsito: null };
      dati.attivita.push(att);
      await salvaJSON(FILE_ATTIVITA, dati);
      return json(res, 200, { ok: true, attivita: att });
    }
    const mAtt = p.match(/^\/api\/attivita\/([\w-]+)$/);
    if (mAtt && req.method === "DELETE") {
      const dati = await leggiJSON(FILE_ATTIVITA, { attivita: [] });
      dati.attivita = dati.attivita.filter((a) => a.id !== mAtt[1]);
      await salvaJSON(FILE_ATTIVITA, dati);
      return json(res, 200, { ok: true });
    }
    if (mAtt && req.method === "POST") {
      const dati = await leggiJSON(FILE_ATTIVITA, { attivita: [] });
      const att = dati.attivita.find((a) => a.id === mAtt[1]);
      if (!att) return err(res, "not found", 404);
      att.attiva = !att.attiva;
      if (att.attiva) att.prossima = prossimaEsecuzione(att.cadenza);
      await salvaJSON(FILE_ATTIVITA, dati);
      return json(res, 200, { ok: true, attiva: att.attiva });
    }

    /* --- connettori MCP --- */
    if (p === "/api/mcp" && req.method === "GET") {
      const cfg = await leggiJSON(FILE_MCP, { servers: {} });
      const stato = [...serverMCP.entries()].map(([nome, s]) => ({ nome, errore: s.errore, tools: s.tools.map((t) => t.name) }));
      return json(res, 200, { config: cfg, stato });
    }
    if (p === "/api/mcp" && req.method === "POST") {
      const { config } = await corpoJSON(req);
      if (!config || typeof config !== "object") return err(res, "config object required");
      await salvaJSON(FILE_MCP, config);
      await avviaMCP();
      const stato = [...serverMCP.entries()].map(([nome, s]) => ({ nome, errore: s.errore, tools: s.tools.map((t) => t.name) }));
      return json(res, 200, { ok: true, stato });
    }

    /* --- aggiornamento --- */
    if (p === "/api/versione" && req.method === "GET") {
      let locale = null;
      try { locale = (await readFile(join(QUI, ".versione"), "utf8")).trim(); } catch {}
      let remota = null;
      try {
        const r = await fetch(REPO_COMMIT_API, { headers: { "user-agent": "free-galatea-code" }, signal: AbortSignal.timeout(10_000) });
        if (r.ok) { const d = await r.json(); remota = { sha: d.sha?.slice(0, 7), data: d.commit?.committer?.date, messaggio: d.commit?.message?.split("\n")[0] }; }
      } catch {}
      return json(res, 200, { locale, remota, git: existsSync(join(QUI, ".git")) });
    }
    if (p === "/api/aggiorna" && req.method === "POST") {
      try {
        const esito = await aggiornaGalatea();
        return json(res, 200, { ok: true, esito, nota: "Restart the app (close and relaunch avvia.cmd) to load the new version." });
      } catch (e) {
        return err(res, String(e.message || e), 500);
      }
    }

    if (p === "/api/verifica" && req.method === "POST") {
      const cfg = await configModello(req);
      if (!cfg.chiave) return err(res, "no key");
      const r = await fetch(`${cfg.base}/chat/completions`, { method: "POST", headers: { authorization: `Bearer ${cfg.chiave}`, "content-type": "application/json" }, body: JSON.stringify({ model: cfg.modello, max_tokens: 16, messages: [{ role: "user", content: "di solo: ok" }] }) });
      const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = {}; }
      return json(res, r.ok ? 200 : r.status, r.ok ? { ok: true, modello: d.model || cfg.modello } : { ok: false, messaggio: d?.error?.message || t.slice(0, 200) });
    }

    err(res, "not found", 404);
  } catch (e) {
    if (!res.headersSent) err(res, String(e.message || e), 500);
    else res.end();
  }
});

server.listen(PORTA, "127.0.0.1", () => {
  console.log("");
  console.log("  FREE GALATEA CODE");
  console.log(`  Aperta su   http://localhost:${PORTA}`);
  console.log(`  Difetti     ${MODELLO_DEFAULT} su ${API_DEFAULT}  -  dati in ${DATI}`);
  console.log("  Ferma con Ctrl+C");
  console.log("");
  avviaMCP();
  avviaScheduler();
});
