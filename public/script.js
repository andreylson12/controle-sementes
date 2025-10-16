
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// Tabs
$$(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    $$(".tab-btn").forEach(b => b.classList.remove("active"));
    $$(".tab").forEach(t => t.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
  });
});

async function api(path, options={}) {
  const res = await fetch(path, {
    headers: { "Content-Type":"application/json" },
    ...options
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(msg || "Erro na API");
  }
  return res.json();
}

function fmt(n) { return Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 2 }); }

// Load data
async function loadLotes() {
  const data = await api("/api/seed-lots");
  const tb = $("#tblLotes tbody");
  tb.innerHTML = "";
  data.forEach(l => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${l.variety}</td>
      <td>${l.supplier}</td>
      <td>${l.lot_code}</td>
      <td>${new Date(l.received_at).toLocaleDateString()}</td>
      <td>${fmt(l.qty)} ${l.unit}</td>
      <td>${fmt(l.balance_kg)} kg</td>
      <td>${l.treated ? "Sim" : "Não"}</td>
      <td>${l.id}</td>`;
    tb.appendChild(tr);
  });
  // selects
  const treatedLots = data; // permitir selecionar todos, mas bloqueio ocorre na API ao mover
  const selT = $("#selLotTrat");
  const selM = $("#selLotMov");
  selT.innerHTML = "";
  selM.innerHTML = "";
  treatedLots.forEach(l => {
    const opt = document.createElement("option");
    opt.value = l.id;
    opt.textContent = `${l.variety} • ${l.lot_code} • saldo ${fmt(l.balance_kg)} kg`;
    selT.appendChild(opt.cloneNode(true));
    selM.appendChild(opt);
  });
}

async function loadTrat() {
  const data = await api("/api/treatments");
  const tb = $("#tblTrat tbody");
  tb.innerHTML = "";
  data.forEach(t => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${t.lot_id}</td>
      <td>${t.product}</td>
      <td>${fmt(t.dose_per_100kg)}</td>
      <td>${t.operator}</td>
      <td>${new Date(t.treated_at).toLocaleDateString()}</td>
      <td>${t.notes || ""}</td>`;
    tb.appendChild(tr);
  });
}

async function loadMov() {
  const data = await api("/api/movements");
  const tb = $("#tblMov tbody");
  tb.innerHTML = "";
  data.forEach(m => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${m.lot_id}</td>
      <td>${m.destination_type}: ${m.destination_name}</td>
      <td>${fmt(m.qty)} ${m.unit}</td>
      <td>${fmt(m.qty_kg)} kg</td>
      <td>${new Date(m.moved_at).toLocaleDateString()}</td>
      <td>${m.notes || ""}</td>`;
    tb.appendChild(tr);
  });
}

async function loadEstoque() {
  const data = await api("/api/inventory");
  const tb = $("#tblEstoque tbody");
  tb.innerHTML = "";
  data.forEach(e => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${e.variety}</td>
      <td>${fmt(e.kg)}</td>
      <td>${fmt(e.sc)}</td>
      <td>${fmt(e.bag)}</td>`;
    tb.appendChild(tr);
  });
}

async function loadCfg() {
  const s = await api("/api/settings");
  const form = $("#formCfg");
  form.kg_per_sc.value = s.units.kg_per_sc;
  form.kg_per_bag.value = s.units.kg_per_bag;
}

// Forms
$("#formLote").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const payload = {
    variety: fd.get("variety"),
    supplier: fd.get("supplier"),
    lot_code: fd.get("lot_code"),
    unit: fd.get("unit"),
    qty: Number(fd.get("qty")),
    received_at: fd.get("received_at")
  };
  try {
    await api("/api/seed-lots", { method:"POST", body: JSON.stringify(payload) });
    e.target.reset();
    await loadLotes();
    alert("Lote salvo!");
  } catch (err) {
    alert(err.message);
  }
});

$("#formTrat").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const payload = {
    lot_id: fd.get("lot_id"),
    product: fd.get("product"),
    dose_per_100kg: Number(fd.get("dose_per_100kg") || 0),
    operator: fd.get("operator"),
    treated_at: fd.get("treated_at"),
    notes: fd.get("notes")
  };
  try {
    await api("/api/treatments", { method:"POST", body: JSON.stringify(payload) });
    e.target.reset();
    await loadTrat();
    await loadLotes();
    alert("Tratamento registrado!");
  } catch (err) {
    alert(err.message);
  }
});

$("#formMov").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const payload = {
    lot_id: fd.get("lot_id"),
    destination_type: fd.get("destination_type"),
    destination_name: fd.get("destination_name"),
    unit: fd.get("unit"),
    qty: Number(fd.get("qty")),
    moved_at: fd.get("moved_at"),
    notes: fd.get("notes")
  };
  try {
    await api("/api/movements", { method:"POST", body: JSON.stringify(payload) });
    e.target.reset();
    await loadMov();
    await loadLotes();
    await loadEstoque();
    alert("Saída registrada!");
  } catch (err) {
    try {
      const j = JSON.parse(err.message);
      alert(j.message || err.message);
    } catch (_e) {
      alert(err.message);
    }
  }
});

$("#formCfg").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const payload = {
    units: {
      kg_per_sc: Number(fd.get("kg_per_sc")),
      kg_per_bag: Number(fd.get("kg_per_bag"))
    }
  };
  try {
    await api("/api/settings", { method:"PUT", body: JSON.stringify(payload) });
    await Promise.all([loadLotes(), loadEstoque()]);
    alert("Configurações salvas!");
  } catch (err) {
    alert(err.message);
  }
});

// Init
(async function init(){
  await loadCfg();
  await loadLotes();
  await loadTrat();
  await loadMov();
  await loadEstoque();
})();
