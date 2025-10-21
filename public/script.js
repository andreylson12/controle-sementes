// =================== CONFIG RELATÓRIO ===================
const REPORT_TITLE = "Faz-Irmãos Coragem: Faz-Assis-Brejinho";
const REPORT_LOGO_URL = "logo.png"; // coloque seu logo aqui (ex.: /assets/logo.png)

// =================== Helpers ===================
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const fmt = (n) => Number(n || 0).toLocaleString("pt-BR", { maximumFractionDigits: 3, minimumFractionDigits: 0 });

// Conversões de unidade para kg (usa SETTINGS quando necessário)
let SETTINGS = null;
const toKg = (qty, unit) => {
  const q = Number(qty||0);
  const perSC  = Number(SETTINGS?.units?.kg_per_sc  || 60);
  const perBag = Number(SETTINGS?.units?.kg_per_bag || 1000);
  if (unit === "kg")  return q;
  if (unit === "sc")  return q * perSC;
  if (unit === "bag") return q * perBag;
  return q;
};

// =================== Áudio/Notificação ===================
let __audioCtx = null;
function ensureAudioCtx() {
  try {
    if (!__audioCtx) __audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (__audioCtx.state === "suspended") __audioCtx.resume().catch(()=>{});
  } catch(e) {}
  return __audioCtx;
}
function primeAudioOnce() {
  const ctx = ensureAudioCtx(); if (!ctx) return;
  try { const o=ctx.createOscillator(), g=ctx.createGain(); o.connect(g); g.connect(ctx.destination); g.gain.setValueAtTime(0.0001, ctx.currentTime); o.start(); o.stop(ctx.currentTime + 0.02); } catch(e) {}
}
function requestNotifPermission() { if ("Notification" in window && Notification.permission !== "granted") Notification.requestPermission().catch(()=>{}); }

// =================== API ===================
async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", "x-user": localStorage.getItem("techName") || "Técnico (anônimo)" },
    ...options,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// =================== Índices/labels ===================
let LOT_INDEX = {};
const lotLabel = (l) => `${l.variety} • ${l.lot_code}`;
const btn = (label, cls = "") => `<button class="action ${cls}" data-action="${label.toLowerCase()}">${label}</button>`;
const rowActions = () => btn("Editar","edit") + " " + btn("Excluir","del");

// =================== Carregamentos ===================
async function loadCfg() {
  try {
    const s = await api("/api/settings");
    SETTINGS = s;
    const f = $("#formCfg");
    if (f) {
      f.querySelector('[name="kg_per_sc"]').value = s?.units?.kg_per_sc ?? 60;
      f.querySelector('[name="kg_per_bag"]').value = s?.units?.kg_per_bag ?? 1000;
    }
  } catch(e){ console.error(e); }
}

async function loadLotes() {
  const data = await api("/api/seed-lots");
  LOT_INDEX = {};
  const tb = $("#tblLotes tbody"); if (tb) tb.innerHTML = "";
  data.forEach(l => {
    LOT_INDEX[l.id] = lotLabel(l);
    if (tb) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${l.variety}</td>
        <td>${l.supplier || ""}</td>
        <td>${l.lot_code}</td>
        <td>${l.received_at ? new Date(l.received_at).toLocaleDateString() : "-"}</td>
        <td>${fmt(l.qty)} ${l.unit}</td>
        <td>${fmt(l.balance_bag)} bag</td>
        <td data-id="${l.id}" data-table="lots">${rowActions()}</td>`;
      tb.appendChild(tr);
    }
  });

  const perBag = Number(SETTINGS?.units?.kg_per_bag || 1000);

  const selT = $("#selLotTrat"), selM = $("#selLotMov");
  if (selT) selT.innerHTML = "";
  if (selM) selM.innerHTML = "";
  data.forEach(l => {
    const opt = document.createElement("option");
    const saldoBags = (Number(l.balance_kg||0)/perBag);
    opt.value = l.id;
    opt.textContent = `${lotLabel(l)} • saldo ${fmt(saldoBags)} bag`;
    if (selT) selT.appendChild(opt.cloneNode(true));
    if (selM) selM.appendChild(opt);
  });
}

async function loadTrat() {
  const data = await api("/api/treatments");
  const tb = $("#tblTrat tbody"); if (tb) tb.innerHTML = "";
  data.forEach(t => {
    const name = t.lot_name || LOT_INDEX[t.lot_id] || t.lot_id;
    if (tb) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${name}</td>
        <td>${t.product || ""}</td>
        <td>${fmt(t.qty_kg || 0)} kg</td>
        <td>${fmt(t.dose_per_100kg || 0)}</td>
        <td>${t.operator || ""}</td>
        <td>${t.treated_at ? new Date(t.treated_at).toLocaleDateString() : "-"}</td>
        <td>${t.notes || ""}</td>
        <td data-id="${t.id}" data-table="treatments">${rowActions()}</td>`;
      tb.appendChild(tr);
    }
  });
}

async function loadMov() {
  const lots = await api("/api/seed-lots");
  const lotById = {}; lots.forEach(l=>lotById[l.id]=l);

  const data = await api("/api/movements");

  // filtros saida
  const varq = ($("#movVar")?.value||"").trim().toLowerCase();
  const from = $("#movFrom")?.value ? new Date($("#movFrom").value) : null;
  const to   = $("#movTo")?.value ? new Date($("#movTo").value) : null;

  const pass = (m)=>{
    const l = lotById[m.lot_id]; if(!l) return false;
    if (varq && !(l.variety||"").toLowerCase().includes(varq)) return false;
    if (from) { const d = new Date(m.moved_at); if (d < from) return false; }
    if (to)   { const d = new Date(m.moved_at); if (d > to)   return false; }
    return true;
  };

  const filtered = data.filter(pass);

  const tb = $("#tblMov tbody"); if (tb) tb.innerHTML = "";
  let sumUnid = 0, sumKg = 0;

  filtered.forEach(m => {
    const name = LOT_INDEX[m.lot_id] || m.lot_id;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${name}</td>
      <td>${m.destination_type || ""}: ${m.destination_name || ""}</td>
      <td>${fmt(m.qty)} ${m.unit}</td>
      <td>${fmt(m.qty_kg)} kg</td>
      <td>${m.moved_at ? new Date(m.moved_at).toLocaleDateString() : "-"}</td>
      <td>${m.notes || ""}</td>
      <td data-id="${m.id}" data-table="movements">${rowActions()}</td>`;
    tb.appendChild(tr);

    sumUnid += Number(m.qty||0);
    sumKg   += Number(m.qty_kg||0);
  });

  $("#movSumUnid").textContent = fmt(sumUnid);
  $("#movSumKg").textContent   = fmt(sumKg);
}

async function loadEstoque() {
  const lots = await api("/api/seed-lots");
  const tb = $("#tblEstoque tbody"); if (!tb) return;
  tb.innerHTML = "";

  const v = ($("#fVar")?.value||"").trim().toLowerCase();
  const l = ($("#fLote")?.value||"").trim().toLowerCase();
  const from = $("#fFrom")?.value ? new Date($("#fFrom").value) : null;
  const to   = $("#fTo")?.value ? new Date($("#fTo").value) : null;
  const onlySaldo = $("#fSaldo")?.checked;

  const filtered = lots.filter(x => {
    if (onlySaldo && Number(x.balance_kg||0) <= 0) return false;
    if (v && !(x.variety||"").toLowerCase().includes(v)) return false;
    if (l && !(x.lot_code||"").toLowerCase().includes(l)) return false;
    if (from) { const d = new Date(x.received_at); if (d < from) return false; }
    if (to)   { const d = new Date(x.received_at); if (d > to)   return false; }
    return true;
  }).sort((a,b)=> (a.variety||"").localeCompare(b.variety||"") || (a.lot_code||"").localeCompare(b.lot_code||""));

  filtered.forEach(lot => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${lot.variety}</td>
      <td>${lot.lot_code}</td>
      <td>${lot.received_at ? new Date(lot.received_at).toLocaleDateString() : "-"}</td>
      <td>${fmt(lot.entrada_kg ?? 0)}</td>
      <td>${fmt(lot.saida_kg ?? 0)}</td>
      <td>${fmt(lot.balance_kg ?? 0)}</td>
      <td>${fmt(lot.balance_sc ?? 0)}</td>
      <td>${fmt(lot.balance_bag ?? 0)}</td>`;
    if ((lot.balance_kg || 0) <= 0) tr.style.opacity = "0.6";
    tb.appendChild(tr);
  });

  const totals = filtered.reduce((a,x)=>{
    a.in  += Number(x.entrada_kg||0);
    a.out += Number(x.saida_kg||0);
    a.kg  += Number(x.balance_kg||0);
    a.sc  += Number(x.balance_sc||0);
    a.bag += Number(x.balance_bag||0);
    return a;
  }, {in:0, out:0, kg:0, sc:0, bag:0});

  const set=(id,v)=>{ const el=document.getElementById(id); if(el) el.textContent = fmt(v||0); };
  set("sumIn", totals.in); set("sumOut", totals.out); set("sumKg", totals.kg); set("sumSc", totals.sc); set("sumBag", totals.bag);

  const sumKg2 = document.getElementById("sumKg2"); if (sumKg2) sumKg2.textContent = fmt(totals.kg||0);
  const sumSc2 = document.getElementById("sumSc2"); if (sumSc2) sumSc2.textContent = fmt(totals.sc||0);
  const sumBag2 = document.getElementById("sumBag2"); if (sumBag2) sumBag2.textContent = fmt(totals.bag||0);
  const countLots = document.getElementById("countLots"); if (countLots) countLots.textContent = `${filtered.length} lote${filtered.length===1?"":"s"}`;
}

// =================== Submits dos formulários ===================
document.addEventListener("submit", async (e) => {
  const form = e.target;
  // CADASTRO
  if (form.id === "formLote") {
    e.preventDefault();
    try {
      const fd = new FormData(form);
      const payload = {
        variety: fd.get("variety"),
        supplier: fd.get("supplier"),
        lot_code: fd.get("lot_code"),
        received_at: fd.get("received_at"),
        unit: fd.get("unit"),
        qty: Number(fd.get("qty")),
      };
      await api("/api/seed-lots", { method: "POST", body: JSON.stringify(payload) });
      form.reset();
      await Promise.all([loadLotes(), loadEstoque()]);
      alert("Lote salvo com sucesso!");
    } catch (err) { try { alert(JSON.parse(err.message).message || err.message); } catch { alert(err.message); } }
  }

  // TRATAMENTO
  if (form.id === "formTrat") {
    e.preventDefault();
    try {
      const fd = new FormData(form);
      const payload = {
        lot_id: fd.get("lot_id"),
        product: fd.get("product"),
        dose_per_100kg: Number(fd.get("dose_per_100kg") || 0),
        operator: fd.get("operator"),
        treated_at: fd.get("treated_at"),
        unit: fd.get("unit"),
        qty: Number(fd.get("qty")),
        notes: fd.get("notes") || "",
      };
      await api("/api/treatments", { method: "POST", body: JSON.stringify(payload) });
      form.reset();
      await Promise.all([loadTrat(), loadLotes(), loadEstoque()]);
      alert("Tratamento registrado!");
    } catch (err) { try { alert(JSON.parse(err.message).message || err.message); } catch { alert(err.message); } }
  }

  // SAÍDA
  if (form.id === "formMov") {
    e.preventDefault();
    try {
      const fd = new FormData(form);
      const payload = {
        lot_id: fd.get("lot_id"),
        destination_type: fd.get("destination_type"),
        destination_name: fd.get("destination_name"),
        unit: fd.get("unit"),
        qty: Number(fd.get("qty")),
        moved_at: fd.get("moved_at"),
        notes: fd.get("notes") || "",
      };
      await api("/api/movements", { method: "POST", body: JSON.stringify(payload) });
      form.reset();
      await Promise.all([loadMov(), loadLotes(), loadEstoque()]);
      alert("Saída registrada!");
    } catch (err) { try { alert(JSON.parse(err.message).message || err.message); } catch { alert(err.message); } }
  }
});

// =================== Botões Editar/Excluir ===================
document.addEventListener("click", async (ev) => {
  const el = ev.target.closest("button.action"); if(!el) return;
  const cell = el.closest("td[data-id]"); const id = cell?.dataset.id; const table = cell?.dataset.table; const action = el.dataset.action;

  try{
    if(action === "excluir"){
      if(!confirm("Confirmar exclusão?")) return;
      if(table==="lots") await api(`/api/seed-lots/${id}`, { method:"DELETE" });
      else if(table==="treatments") await api(`/api/treatments/${id}`, { method:"DELETE" });
      else if(table==="movements") await api(`/api/movements/${id}`, { method:"DELETE" });
      await Promise.all([loadLotes(), loadTrat(), loadMov(), loadEstoque()]);
      alert("Excluído com sucesso!");
      return;
    }
    if(action === "editar"){
      if(table==="lots"){
        const variety = prompt("Variedade:"); const supplier = prompt("Fornecedor:");
        const lot_code = prompt("Código do lote:"); const unit = prompt("Unidade (kg/sc/bag):","kg");
        const qty = Number(prompt("Quantidade (na unidade):","0")); const received_at = prompt("Data (yyyy-mm-dd):");
        await api(`/api/seed-lots/${id}`, { method:"PUT", body: JSON.stringify({ variety, supplier, lot_code, unit, qty, received_at }) });
      }else if(table==="treatments"){
        const product = prompt("Produto:"); const dose_per_100kg = Number(prompt("Dose por 100kg:","0"));
        const operator = prompt("Operador:"); const treated_at = prompt("Data (yyyy-mm-dd):");
        const unit = prompt("Unidade tratada (kg/sc/bag):","kg"); const qty = Number(prompt("Quantidade tratada:","0"));
        const notes = prompt("Observações:");
        await api(`/api/treatments/${id}`, { method:"PUT", body: JSON.stringify({ product, dose_per_100kg, operator, treated_at, unit, qty, notes }) });
      }else if(table==="movements"){
        const destination_type = prompt("Destino (lavoura/fazenda):","lavoura");
        const destination_name = prompt("Nome do destino:");
        const unit = prompt("Unidade (kg/sc/bag):","kg"); const qty = Number(prompt("Quantidade:","0"));
        const moved_at = prompt("Data (yyyy-mm-dd):"); const notes = prompt("Observações:");
        await api(`/api/movements/${id}`, { method:"PUT", body: JSON.stringify({ destination_type, destination_name, unit, qty, moved_at, notes }) });
      }
      await Promise.all([loadLotes(), loadTrat(), loadMov(), loadEstoque]()
