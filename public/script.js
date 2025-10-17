
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// ===== Alert infra =====
let __audioCtx = null;
function ensureAudioCtx() {
  try {
    if (!__audioCtx) __audioCtx = new (window.AudioContext||window.webkitAudioContext)();
    if (__audioCtx.state === "suspended") __audioCtx.resume().catch(()=>{});
  } catch(e) {}
  return __audioCtx;
}
function primeAudioOnce() {
  const ctx = ensureAudioCtx();
  if (!ctx) return;
  try {
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    o.start(); o.stop(ctx.currentTime + 0.02); // 20ms inaudible blip just to unlock
  } catch(e) {}
}
function requestNotifPermission() {
  if ("Notification" in window && Notification.permission !== "granted") {
    Notification.requestPermission().catch(()=>{});
  }
}



// Técnico chooser
document.addEventListener("DOMContentLoaded", () => {
  requestNotifPermission();
  const inp = document.getElementById("techName");
  const btn = document.getElementById("saveTech");
  if (inp) { inp.value = localStorage.getItem("techName") || ""; inp.addEventListener("blur", ()=>localStorage.setItem("techName", (inp.value||"").trim()||"Técnico (anônimo)")); }
  if (btn) btn.addEventListener("click", () => {
    const v = (inp?.value || "").trim() || "Técnico (anônimo)";
    localStorage.setItem("techName", v);
    primeAudioOnce(); requestNotifPermission(); alert("Técnico definido!");
  });
  const bell = document.getElementById("enableAlerts");
  if (bell) bell.addEventListener("click", ()=>{ primeAudioOnce(); requestNotifPermission(); alert("Alertas ativados!"); });
  const filters = ["fVar","fLote","fFrom","fTo","fSaldo"];
  filters.forEach(id=>{ const el=document.getElementById(id); if(el) el.addEventListener("input", ()=>loadEstoque()); });
  const btnF=document.getElementById("btnFiltrar"); if(btnF) btnF.addEventListener("click", ()=>loadEstoque());
  const btnL=document.getElementById("btnLimpar"); if(btnL) btnL.addEventListener("click", ()=>{ filters.forEach(id=>{ const el=document.getElementById(id); if(!el) return; if(el.type==="checkbox") el.checked=true; else el.value=""; }); loadEstoque(); });
  const bIn=document.getElementById("btnPDFEntradas"); if(bIn) bIn.addEventListener("click", ()=>generatePDF("entradas"));
  const bOut=document.getElementById("btnPDFSaidas"); if(bOut) bOut.addEventListener("click", ()=>generatePDF("saidas"));
});
// Tabs
$$(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    $$(".tab-btn").forEach((b) => b.classList.remove("active"));
    $$(".tab").forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
  });
});

async function api(path, options = {}) {
  const res = await fetch(path, { headers: { "Content-Type": "application/json", "x-user": (localStorage.getItem("techName") || "Técnico (anônimo)") }, ...options });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
function fmt(n) { return Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 3, minimumFractionDigits: 0 }); }

let LOT_INDEX = {}; // id -> "Variedade • Código"
const lotLabel = (l) => `${l.variety} • ${l.lot_code}`;

const btn = (label, cls="") => `<button class="action ${cls}" data-action="${label.toLowerCase()}">${label}</button>`;
function rowActions(){ return btn("Editar","edit")+" "+btn("Excluir","del"); }

// LOADERS
async function loadLotes() {
  const data = await api("/api/seed-lots");
  LOT_INDEX = {};
  const tb = $("#tblLotes tbody"); tb.innerHTML = "";
  data.forEach(l => {
    LOT_INDEX[l.id] = lotLabel(l);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${l.variety}</td>
      <td>${l.supplier}</td>
      <td>${l.lot_code}</td>
      <td>${new Date(l.received_at).toLocaleDateString()}</td>
      <td>${fmt(l.qty)} ${l.unit}</td>
      <td>${fmt(l.balance_bag)} bag</td>
      <td data-id="${l.id}" data-table="lots">${rowActions()}</td>`;
    tb.appendChild(tr);
  });
  const selT = $("#selLotTrat"), selM = $("#selLotMov");
  selT.innerHTML = ""; selM.innerHTML = "";
  data.forEach(l => {
    const opt = document.createElement("option");
    opt.value = l.id;
    opt.textContent = `${lotLabel(l)} • saldo ${fmt(l.balance_kg)} kg • tratado disp. ${fmt(l.treated_available_kg||0)} kg`;
    selT.appendChild(opt.cloneNode(true));
    selM.appendChild(opt);
  });
}

async function loadTrat() {
  const data = await api("/api/treatments");
  const tb = $("#tblTrat tbody"); tb.innerHTML = "";
  data.forEach(t => {
    const name = t.lot_name || LOT_INDEX[t.lot_id] || t.lot_id;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${name}</td>
      <td>${t.product}</td>
      <td>${fmt(t.qty_kg || 0)} kg</td>
      <td>${fmt(t.dose_per_100kg || 0)}</td>
      <td>${t.operator}</td>
      <td>${new Date(t.treated_at).toLocaleDateString()}</td>
      <td>${t.notes || ""}</td>
      <td data-id="${t.id}" data-table="treatments">${rowActions()}</td>`;
    tb.appendChild(tr);
  });
}

async function loadMov() {
  const data = await api("/api/movements");
  const tb = $("#tblMov tbody"); tb.innerHTML = "";
  data.forEach(m => {
    const name = LOT_INDEX[m.lot_id] || m.lot_id;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${name}</td>
      <td>${m.destination_type}: ${m.destination_name}</td>
      <td>${fmt(m.qty)} ${m.unit}</td>
      <td>${fmt(m.qty_kg)} kg</td>
      <td>${new Date(m.moved_at).toLocaleDateString()}</td>
      <td>${m.notes || ""}</td>
      <td data-id="${m.id}" data-table="movements">${rowActions()}</td>`;
    tb.appendChild(tr);
  });
}


async function loadEstoque() {
  // Estoque por LOTE
  const lots = await api("/api/seed-lots");
  const tb = $("#tblEstoque tbody"); 
  tb.innerHTML = "";

  // Read filters
  const v = ($("#fVar")?.value||"").trim().toLowerCase();
  const l = ($("#fLote")?.value||"").trim().toLowerCase();
  const from = $("#fFrom")?.value ? new Date($("#fFrom").value) : null;
  const to = $("#fTo")?.value ? new Date($("#fTo").value) : null;
  const onlySaldo = $("#fSaldo")?.checked;

  const filtered = lots.filter(x => {
    if (onlySaldo && (Number(x.balance_kg||0) <= 0)) return false;
    if (v && !(x.variety||"").toLowerCase().includes(v)) return false;
    if (l && !(x.lot_code||"").toLowerCase().includes(l)) return false;
    if (from) {
      const d = new Date(x.received_at); if (!(d >= from)) return false;
    }
    if (to) {
      const d = new Date(x.received_at); if (!(d <= to)) return false;
    }
    return true;
  });

  filtered.sort((a,b) => (a.variety||"").localeCompare(b.variety||"") || (a.lot_code||"").localeCompare(b.lot_code||""));

  filtered.forEach(lot => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${lot.variety}</td>
      <td>${lot.lot_code}</td>
      <td>${lot.received_at ? new Date(lot.received_at).toLocaleDateString() : "-"}</td>
      <td>${fmt(lot.balance_kg)}</td>
      <td>${fmt(lot.balance_sc)}</td>
      <td>${fmt(lot.balance_bag)}</td>`;
    if ((lot.balance_kg || 0) <= 0) tr.style.opacity = "0.6"; // marca zerados
    tb.appendChild(tr);
  });
}

async function loadCfg() {
  const s = await api("/api/settings");
  const f = $("#formCfg"); 
  f.kg_per_sc.value = s.units.kg_per_sc; 
  f.kg_per_bag.value = s.units.kg_per_bag;
}

// FORMS
$("#formLote").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const payload = { variety:fd.get("variety"), supplier:fd.get("supplier"), lot_code:fd.get("lot_code"), unit:fd.get("unit"), qty:Number(fd.get("qty")), received_at:fd.get("received_at") };
  await api("/api/seed-lots", { method:"POST", body: JSON.stringify(payload) });
  e.target.reset(); await loadLotes(); alert("Lote salvo!");
});

$("#formTrat").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const payload = { lot_id:fd.get("lot_id"), product:fd.get("product"), dose_per_100kg:Number(fd.get("dose_per_100kg")||0), operator:fd.get("operator"), treated_at:fd.get("treated_at"), unit:fd.get("unit"), qty:Number(fd.get("qty")), notes:fd.get("notes") };
  await api("/api/treatments", { method:"POST", body: JSON.stringify(payload) });
  e.target.reset(); await loadTrat(); await loadLotes(); alert("Tratamento registrado!");
});

$("#formMov").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const payload = { lot_id:fd.get("lot_id"), destination_type:fd.get("destination_type"), destination_name:fd.get("destination_name"), unit:fd.get("unit"), qty:Number(fd.get("qty")), moved_at:fd.get("moved_at"), notes:fd.get("notes") };
  try{
    await api("/api/movements", { method:"POST", body: JSON.stringify(payload) });
    e.target.reset(); await loadMov(); await loadLotes(); await loadEstoque(); alert("Saída registrada!");
  }catch(err){ try{ const j=JSON.parse(err.message); alert(j.message||err.message); }catch{ alert(err.message); } }
});

$("#formCfg").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const payload = { units:{ kg_per_sc:Number(fd.get("kg_per_sc")), kg_per_bag:Number(fd.get("kg_per_bag")) } };
  await api("/api/settings", { method:"PUT", body: JSON.stringify(payload) });
  await Promise.all([loadLotes(), loadEstoque()]); alert("Configurações salvas!");
});

// ACTION BUTTONS (edit/delete)
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
      await Promise.all([loadLotes(), loadTrat(), loadMov(), loadEstoque()]);
      alert("Editado com sucesso!");
    }
  }catch(err){ try{ const j=JSON.parse(err.message); alert(j.message||err.message); }catch{ alert(err.message); } }
});


// Simple print-to-PDF generator
async function generatePDF(type){
  const s = await api("/api/settings");
  const perSC = s.units.kg_per_sc || 60;
  const perBag = s.units.kg_per_bag || 1000;

  const css = `
    <style>
      body{ font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; padding: 24px; color:#111 }
      h1{ font-size:20px; margin:0 0 12px }
      table{ width:100%; border-collapse: collapse; }
      th,td{ border:1px solid #ddd; padding:6px 8px; font-size:12px }
      th{ background:#f3f4f6; text-align:left }
      tfoot td{ font-weight:600; }
      .meta{ font-size:12px; color:#555; margin-bottom:8px }
    </style>
  `;

  if(type==="entradas"){
    const rows = await api("/api/seed-lots");
    const htmlRows = rows.map(r=>`<tr>
      <td>${r.variety||""}</td>
      <td>${r.lot_code||""}</td>
      <td>${r.received_at ? new Date(r.received_at).toLocaleDateString() : "-"}</td>
      <td style="text-align:right">${(r.qty??0)} ${r.unit||""}</td>
      <td style="text-align:right">${(r.balance_kg??0).toLocaleString()}</td>
      <td style="text-align:right">${(r.balance_sc??0).toLocaleString()}</td>
      <td style="text-align:right">${(r.balance_bag??0).toLocaleString()}</td>
    </tr>`).join("");
    const w = window.open("", "_blank");
    w.document.write(`<!doctype html><html><head><meta charset="utf-8">${css}</head><body>
      <h1>Relatório de Entradas (Lotes Recebidos)</h1>
      <div class="meta">Gerado em ${new Date().toLocaleString()}</div>
      <table>
        <thead><tr><th>Variedade</th><th>Lote</th><th>Recebido em</th><th>Qtd</th><th>kg saldo</th><th>sc saldo</th><th>bag saldo</th></tr></thead>
        <tbody>${htmlRows}</tbody>
      </table>
    </body></html>`);
    w.document.close(); w.focus(); w.print();
  } else {
    const lots = await api("/api/seed-lots");
    const names = {}; lots.forEach(l=>names[l.id]=`${l.variety||""} • ${l.lot_code||l.id}`);
    const rows = await api("/api/movements");
    const htmlRows = rows.map(r=>`<tr>
      <td>${names[r.lot_id]||r.lot_id}</td>
      <td>${r.destination_type||""}: ${r.destination_name||""}</td>
      <td>${r.moved_at ? new Date(r.moved_at).toLocaleDateString() : "-"}</td>
      <td style="text-align:right">${(r.qty??0)} ${r.unit||""}</td>
    </tr>`).join("");
    const w = window.open("", "_blank");
    w.document.write(`<!doctype html><html><head><meta charset="utf-8">${css}</head><body>
      <h1>Relatório de Saídas</h1>
      <div class="meta">Gerado em ${new Date().toLocaleString()}</div>
      <table>
        <thead><tr><th>Lote</th><th>Destino</th><th>Data</th><th>Quantidade</th></tr></thead>
        <tbody>${htmlRows}</tbody>
      </table>
    </body></html>`);
    w.document.close(); w.focus(); w.print();
  }
}
// realtime
if (window.io) {
  const socket = io();
  let cooling = false;
  function refreshFor(type) {
    if (cooling) return;
    cooling = true;
    setTimeout(async () => {
      cooling = false;
      if (type === "lots" || type === "settings") {
        await Promise.all([loadLotes(), loadEstoque()]);
      }
      if (type === "treatments") {
        await Promise.all([loadTrat(), loadLotes(), loadEstoque()]);
      }
      if (type === "movements") {
        await Promise.all([loadMov(), loadLotes(), loadEstoque()]);
      }
    }, 300);
  }
  socket.on("data:update", ({ type }) => refreshFor(type));

  // Notifications permission
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }

  function beep(){
    try {
      const ctx = ensureAudioCtx(); if(!ctx) return;
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type="sine"; o.frequency.value=880; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.2, ctx.currentTime);
      o.start(); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime+0.6); o.stop(ctx.currentTime+0.6);
    } catch(e) {}
  }
  function toast(msg){
    const box=document.getElementById("toasts"); if(!box) return;
    const el=document.createElement("div");
    el.textContent = msg;
    el.style.cssText="background:#111;color:#fff;padding:.6rem .8rem;margin-top:.5rem;border-radius:.5rem;box-shadow:0 4px 16px rgba(0,0,0,.25);max-width:360px";
    box.appendChild(el); setTimeout(()=>el.remove(), 8000);
  }

  socket.on("alarm", (ev) => {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("Controle de Sementes", { body: ev.message });
    }
    toast(ev.message);
    beep();
  });
}

(async function init(){
  if(!localStorage.getItem("techName")){
    try{ const n = prompt("Seu nome (técnico) para auditoria/alertas:"); if(n) localStorage.setItem("techName", n.trim()); }catch(e){}
  }

  await loadCfg();
  await loadLotes();
  await loadTrat();
  await loadMov();
  await loadEstoque();
})();
