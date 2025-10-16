const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

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
  const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...options });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
function fmt(n) {
  return Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 3, minimumFractionDigits: 0 });
}

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

  lots.sort((a,b) => (a.variety||"").localeCompare(b.variety||"") || (a.lot_code||"").localeCompare(b.lot_code||""));

  lots.forEach(l => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${l.variety}</td>
      <td>${l.lot_code}</td>
      <td>${fmt(l.balance_kg)}</td>
      <td>${fmt(l.balance_sc)}</td>
      <td>${fmt(l.balance_bag)}</td>`;
    if ((l.balance_kg || 0) <= 0) tr.style.opacity = "0.6"; // marca zerados
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

// Init
(async function init(){
  await loadCfg();
  await loadLotes();
  await loadTrat();
  await loadMov();
  await loadEstoque();
})();
