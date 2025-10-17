// ========= Helpers =========
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
function fmt(n){ return Number(n || 0).toLocaleString("pt-BR",{maximumFractionDigits:3,minimumFractionDigits:0}); }

// ========= Config global (kg/sc e kg/bag) =========
let SETTINGS = { units: { kg_per_sc: 60, kg_per_bag: 1000 } };
function toBag(kg){ const per = SETTINGS?.units?.kg_per_bag || 1000; return Number(kg)/per; }

// ========= Áudio/Notificação =========
let __audioCtx = null;
function ensureAudioCtx(){ try{ if(!__audioCtx) __audioCtx = new (window.AudioContext||window.webkitAudioContext)(); if(__audioCtx.state==="suspended") __audioCtx.resume().catch(()=>{});}catch(e){} return __audioCtx; }
function primeAudioOnce(){ const ctx=ensureAudioCtx(); if(!ctx) return; try{ const o=ctx.createOscillator(); const g=ctx.createGain(); o.connect(g); g.connect(ctx.destination); g.gain.setValueAtTime(0.0001,ctx.currentTime); o.start(); o.stop(ctx.currentTime+0.02);}catch(e){} }
function requestNotifPermission(){ if("Notification" in window && Notification.permission!=="granted"){ Notification.requestPermission().catch(()=>{});} }

// ========= API =========
async function api(path, options = {}){
  const res = await fetch(path,{ headers:{ "Content-Type":"application/json","x-user": localStorage.getItem("techName")||"Técnico (anônimo)" }, ...options });
  if(!res.ok) throw new Error(await res.text());
  return res.json();
}

// ========= Índices/labels =========
let LOT_INDEX = {};
const lotLabel = (l) => `${l.variety} • ${l.lot_code}`;
const btn = (label, cls="") => `<button class="action ${cls}" data-action="${label.toLowerCase()}">${label}</button>`;
function rowActions(){ return btn("Editar","edit")+" "+btn("Excluir","del"); }

// ========= Carregamentos =========
async function loadCfg(){
  try{
    const s = await api("/api/settings");
    SETTINGS = s || SETTINGS; // guarda global
    const f = $("#formCfg");
    if(f){
      f.querySelector('[name="kg_per_sc"]').value  = SETTINGS?.units?.kg_per_sc  ?? 60;
      f.querySelector('[name="kg_per_bag"]').value = SETTINGS?.units?.kg_per_bag ?? 1000;
    }
  }catch(e){ console.error(e); }
}

async function loadLotes(){
  const data = await api("/api/seed-lots");
  LOT_INDEX = {};
  const tb = $("#tblLotes tbody"); if(tb) tb.innerHTML="";
  data.forEach(l=>{
    LOT_INDEX[l.id]=lotLabel(l);
    if(tb){
      const tr=document.createElement("tr");
      tr.innerHTML=`
        <td>${l.variety}</td>
        <td>${l.supplier||""}</td>
        <td>${l.lot_code}</td>
        <td>${l.received_at?new Date(l.received_at).toLocaleDateString():"-"}</td>
        <td>${fmt(l.qty)} ${l.unit}</td>
        <td>${fmt(l.balance_bag)} bag</td>
        <td data-id="${l.id}" data-table="lots">${rowActions()}</td>`;
      tb.appendChild(tr);
    }
  });
  const selT=$("#selLotTrat"), selM=$("#selLotMov");
  if(selT) selT.innerHTML=""; if(selM) selM.innerHTML="";
  data.forEach(l=>{
    const opt=document.createElement("option");
    opt.value=l.id;
    opt.textContent=`${lotLabel(l)} • saldo ${fmt(l.balance_kg)} kg`;
    if(selT) selT.appendChild(opt.cloneNode(true));
    if(selM) selM.appendChild(opt);
  });
}

async function loadTrat(){
  const data = await api("/api/treatments");
  const tb = $("#tblTrat tbody"); if(tb) tb.innerHTML = "";
  data.forEach(t=>{
    const name = t.lot_name || LOT_INDEX[t.lot_id] || t.lot_id;
    const kg   = Number(t.qty_kg || 0);
    const bag  = toBag(kg);
    if(tb){
      const tr=document.createElement("tr");
      tr.innerHTML = `
        <td>${name}</td>
        <td>${t.product || ""}</td>
        <td>${fmt(bag)} bag <small style="opacity:.7">(${fmt(kg)} kg)</small></td>
        <td>${fmt(t.dose_per_100kg || 0)}</td>
        <td>${t.operator || ""}</td>
        <td>${t.treated_at ? new Date(t.treated_at).toLocaleDateString() : "-"}</td>
        <td>${t.notes || ""}</td>
        <td data-id="${t.id}" data-table="treatments">${rowActions()}</td>`;
      tb.appendChild(tr);
    }
  });

  // opcional: ajustar cabeçalho para refletir kg/bag
  const ths = document.querySelectorAll("#tblTrat thead th");
  if(ths[2]) ths[2].textContent = "Qtd tratada (bag / kg)";
}

async function loadMov(){
  const data = await api("/api/movements");
  const tb = $("#tblMov tbody"); if(tb) tb.innerHTML="";
  data.forEach(m=>{
    const name = LOT_INDEX[m.lot_id] || m.lot_id;
    if(tb){
      const tr=document.createElement("tr");
      tr.innerHTML=`
        <td>${name}</td>
        <td>${m.destination_type||""}: ${m.destination_name||""}</td>
        <td>${fmt(m.qty)} ${m.unit}</td>
        <td>${fmt(m.qty_kg)} kg</td>
        <td>${m.moved_at?new Date(m.moved_at).toLocaleDateString():"-"}</td>
        <td>${m.notes||""}</td>
        <td data-id="${m.id}" data-table="movements">${rowActions()}</td>`;
      tb.appendChild(tr);
    }
  });
}

async function loadEstoque(){
  const lots = await api("/api/seed-lots");
  const tb = $("#tblEstoque tbody"); if(!tb) return;
  tb.innerHTML="";

  const v=($("#fVar")?.value||"").trim().toLowerCase();
  const l=($("#fLote")?.value||"").trim().toLowerCase();
  const from=$("#fFrom")?.value?new Date($("#fFrom").value):null;
  const to=$("#fTo")?.value?new Date($("#fTo").value):null;
  const onlySaldo=$("#fSaldo")?.checked;

  const filtered = lots.filter(x=>{
    if(onlySaldo && Number(x.balance_kg||0)<=0) return false;
    if(v && !(x.variety||"").toLowerCase().includes(v)) return false;
    if(l && !(x.lot_code||"").toLowerCase().includes(l)) return false;
    if(from){ const d=new Date(x.received_at); if(!(d>=from)) return false; }
    if(to){   const d=new Date(x.received_at); if(!(d<=to))   return false; }
    return true;
  }).sort((a,b)=> (a.variety||"").localeCompare(b.variety||"") || (a.lot_code||"").localeCompare(b.lot_code||""));

  filtered.forEach(lot=>{
    const tr=document.createElement("tr");
    tr.innerHTML=`
      <td>${lot.variety}</td>
      <td>${lot.lot_code}</td>
      <td>${lot.received_at?new Date(lot.received_at).toLocaleDateString():"-"}</td>
      <td>${(lot.entrada_kg??0).toLocaleString()}</td>
      <td>${(lot.saida_kg??0).toLocaleString()}</td>
      <td>${(lot.balance_kg??0).toLocaleString()}</td>
      <td>${(lot.balance_sc??0).toLocaleString()}</td>
      <td>${(lot.balance_bag??0).toLocaleString()}</td>`;
    if((lot.balance_kg||0)<=0) tr.style.opacity="0.6";
    tb.appendChild(tr);
  });

  const totals = filtered.reduce((a,x)=>{
    a.in  += Number(x.entrada_kg||0);
    a.out += Number(x.saida_kg||0);
    a.kg  += Number(x.balance_kg||0);
    a.sc  += Number(x.balance_sc||0);
    a.bag += Number(x.balance_bag||0);
    return a;
  },{in:0,out:0,kg:0,sc:0,bag:0});

  const set=(id,v)=>{ const el=document.getElementById(id); if(el) el.textContent = Number(v||0).toLocaleString(); };
  set("sumIn",totals.in); set("sumOut",totals.out); set("sumKg",totals.kg); set("sumSc",totals.sc); set("sumBag",totals.bag);

  $("#sumKg2") && ($("#sumKg2").textContent=fmt(totals.kg));
  $("#sumSc2") && ($("#sumSc2").textContent=fmt(totals.sc));
  $("#sumBag2") && ($("#sumBag2").textContent=fmt(totals.bag));
  $("#countLots") && ($("#countLots").textContent=`${filtered.length} lote${filtered.length===1?"":"s"}`);
}

// ========= Submits =========
document.addEventListener("submit", async (e)=>{
  const form=e.target;

  // Lotes
  if(form.id==="formLote"){
    e.preventDefault();
    try{
      const fd=new FormData(form);
      const payload={ variety:fd.get("variety"), supplier:fd.get("supplier"), lot_code:fd.get("lot_code"),
        received_at:fd.get("received_at"), unit:fd.get("unit"), qty:Number(fd.get("qty")) };
      await api("/api/seed-lots",{method:"POST",body:JSON.stringify(payload)});
      form.reset(); await Promise.all([loadLotes(),loadEstoque()]); alert("Lote salvo com sucesso!");
    }catch(err){ try{alert(JSON.parse(err.message).message||err.message);}catch{alert(err.message);} }
    return;
  }

  // Tratamento
  if(form.id==="formTrat"){
    e.preventDefault();
    try{
      const fd=new FormData(form);
      const payload={ lot_id:fd.get("lot_id"), product:fd.get("product"),
        dose_per_100kg:Number(fd.get("dose_per_100kg")||0), operator:fd.get("operator"),
        treated_at:fd.get("treated_at"), unit:fd.get("unit"), qty:Number(fd.get("qty")),
        notes:fd.get("notes")||"" };
      await api("/api/treatments",{method:"POST",body:JSON.stringify(payload)});
      form.reset(); await Promise.all([loadTrat(),loadLotes(),loadEstoque()]); alert("Tratamento registrado!");
    }catch(err){ try{alert(JSON.parse(err.message).message||err.message);}catch{alert(err.message);} }
    return;
  }

  // Saída
  if(form.id==="formMov"){
    e.preventDefault();
    try{
      const fd=new FormData(form);
      const payload={ lot_id:fd.get("lot_id"), destination_type:fd.get("destination_type"),
        destination_name:fd.get("destination_name"), unit:fd.get("unit"), qty:Number(fd.get("qty")),
        moved_at:fd.get("moved_at"), notes:fd.get("notes")||"" };
      await api("/api/movements",{method:"POST",body:JSON.stringify(payload)});
      form.reset(); await Promise.all([loadMov(),loadLotes(),loadEstoque()]); alert("Saída registrada!");
    }catch(err){ try{alert(JSON.parse(err.message).message||err.message);}catch{alert(err.message);} }
  }
});

// ========= Ações Editar/Excluir =========
document.addEventListener("click", async (ev)=>{
  const el=ev.target.closest("button.action"); if(!el) return;
  const cell=el.closest("td[data-id]"); const id=cell?.dataset.id; const table=cell?.dataset.table; const action=el.dataset.action;

  try{
    if(action==="excluir"){
      if(!confirm("Confirmar exclusão?")) return;
      if(table==="lots") await api(`/api/seed-lots/${id}`,{method:"DELETE"});
      else if(table==="treatments") await api(`/api/treatments/${id}`,{method:"DELETE"});
      else if(table==="movements") await api(`/api/movements/${id}`,{method:"DELETE"});
      await Promise.all([loadLotes(),loadTrat(),loadMov(),loadEstoque()]);
      alert("Excluído com sucesso!"); return;
    }
    if(action==="editar"){
      if(table==="lots"){
        const variety=prompt("Variedade:"); const supplier=prompt("Fornecedor:");
        const lot_code=prompt("Código do lote:"); const unit=prompt("Unidade (kg/sc/bag):","kg");
        const qty=Number(prompt("Quantidade (na unidade):","0")); const received_at=prompt("Data (yyyy-mm-dd):");
        await api(`/api/seed-lots/${id}`,{method:"PUT",body:JSON.stringify({variety,supplier,lot_code,unit,qty,received_at})});
      }else if(table==="treatments"){
        const product=prompt("Produto:"); const dose_per_100kg=Number(prompt("Dose por 100kg:","0"));
        const operator=prompt("Operador:"); const treated_at=prompt("Data (yyyy-mm-dd):");
        const unit=prompt("Unidade tratada (kg/sc/bag):","kg"); const qty=Number(prompt("Quantidade tratada:","0"));
        const notes=prompt("Observações:");
        await api(`/api/treatments/${id}`,{method:"PUT",body:JSON.stringify({product,dose_per_100kg,operator,treated_at,unit,qty,notes})});
      }else if(table==="movements"){
        const destination_type=prompt("Destino (lavoura/fazenda):","lavoura");
        const destination_name=prompt("Nome do destino:");
        const unit=prompt("Unidade (kg/sc/bag):","kg"); const qty=Number(prompt("Quantidade:","0"));
        const moved_at=prompt("Data (yyyy-mm-dd):"); const notes=prompt("Observações:");
        await api(`/api/movements/${id}`,{method:"PUT",body:JSON.stringify({destination_type,destination_name,unit,qty,moved_at,notes})});
      }
      await Promise.all([loadLotes(),loadTrat(),loadMov(),loadEstoque()]);
      alert("Editado com sucesso!");
    }
  }catch(err){ try{const j=JSON.parse(err.message); alert(j.message||err.message);}catch{ alert(err.message);} }
});

// ========= Config submit =========
$("#formCfg")?.addEventListener("submit", async (e)=>{
  e.preventDefault();
  const fd=new FormData(e.target);
  const payload={ units:{ kg_per_sc:Number(fd.get("kg_per_sc")), kg_per_bag:Number(fd.get("kg_per_bag")) } };
  await api("/api/settings",{method:"PUT",body:JSON.stringify(payload)});
  await Promise.all([loadCfg(),loadLotes(),loadEstoque()]);
  alert("Configurações salvas!");
});

// ===== Relatórios (print) =====
async function generatePDF(type){
  const css=`<style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:24px;color:#111}
    h1{font-size:20px;margin:0 0 12px}.meta{font-size:12px;color:#555;margin-bottom:8px}
    table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:6px 8px;font-size:12px}
    th{background:#f3f4f6;text-align:left} tfoot td{font-weight:600}
  </style>`;
  if(type==="entradas"){
    const rows=await api("/api/seed-lots");
    const htmlRows=rows.map(r=>`<tr>
      <td>${r.variety||""}</td><td>${r.lot_code||""}</td>
      <td>${r.received_at?new Date(r.received_at).toLocaleDateString():"-"}</td>
      <td style="text-align:right">${(r.qty??0)} ${r.unit||""}</td>
      <td style="text-align:right">${(r.balance_kg??0).toLocaleString()}</td>
      <td style="text-align:right">${(r.balance_sc??0).toLocaleString()}</td>
      <td style="text-align:right">${(r.balance_bag??0).toLocaleString()}</td>
    </tr>`).join("");
    const w=window.open("", "_blank");
    w.document.write(`<!doctype html><html><head><meta charset="utf-8">${css}</head><body>
      <h1>Relatório de Entradas (Lotes Recebidos)</h1>
      <div class="meta">Gerado em ${new Date().toLocaleString()}</div>
      <table><thead><tr><th>Variedade</th><th>Lote</th><th>Recebido em</th><th>Qtd</th><th>kg saldo</th><th>sc saldo</th><th>bag saldo</th></tr></thead>
      <tbody>${htmlRows}</tbody></table></body></html>`);
    w.document.close(); w.focus(); w.print();
  }else{
    const lots=await api("/api/seed-lots"); const names={}; lots.forEach(l=>names[l.id]=`${l.variety||""} • ${l.lot_code||l.id}`);
    const rows=await api("/api/movements");
    const htmlRows=rows.map(r=>`<tr>
      <td>${names[r.lot_id]||r.lot_id}</td><td>${r.destination_type||""}: ${r.destination_name||""}</td>
      <td>${r.moved_at?new Date(r.moved_at).toLocaleDateString():"-"}</td>
      <td style="text-align:right">${(r.qty??0)} ${r.unit||""}</td>
    </tr>`).join("");
    const w=window.open("", "_blank");
    w.document.write(`<!doctype html><html><head><meta charset="utf-8">${css}</head><body>
      <h1>Relatório de Saídas</h1>
      <div class="meta">Gerado em ${new Date().toLocaleString()}</div>
      <table><thead><tr><th>Lote</th><th>Destino</th><th>Data</th><th>Quantidade</th></tr></thead>
      <tbody>${htmlRows}</tbody></table></body></html>`);
    w.document.close(); w.focus(); w.print();
  }
}

// ========= Realtime / Alertas =========
if(window.io){
  const socket=io(); let cooling=false;
  function refreshFor(type){
    if(cooling) return; cooling=true;
    setTimeout(async()=>{ cooling=false;
      if(type==="lots"||type==="settings") await Promise.all([loadLotes(),loadEstoque()]);
      if(type==="treatments") await Promise.all([loadTrat(),loadLotes(),loadEstoque()]);
      if(type==="movements") await Promise.all([loadMov(),loadLotes(),loadEstoque()]);
    },300);
  }
  socket.on("data:update",({type})=>refreshFor(type));

  function beep(){ try{ const ctx=ensureAudioCtx(); if(!ctx) return;
    const o=ctx.createOscillator(); const g=ctx.createGain();
    o.type="sine"; o.frequency.value=880; o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.2,ctx.currentTime);
    o.start(); g.gain.exponentialRampToValueAtTime(0.0001,ctx.currentTime+0.6); o.stop(ctx.currentTime+0.6);
  }catch(e){} }
  function toast(msg){ const box=$("#toasts"); if(!box) return;
    const el=document.createElement("div"); el.textContent=msg;
    el.style.cssText="background:#111;color:#fff;padding:.6rem .8rem;margin-top:.5rem;border-radius:.5rem;box-shadow:0 4px 16px rgba(0,0,0,.25);max-width:360px";
    box.appendChild(el); setTimeout(()=>el.remove(),8000); }
  socket.on("alarm",(ev)=>{ if("Notification" in window && Notification.permission==="granted"){ new Notification("Controle de Sementes",{body:ev.message}); } toast(ev.message); beep(); });
}

// ========= DOM Ready =========
document.addEventListener("DOMContentLoaded", ()=>{
  requestNotifPermission();
  const inp=$("#techName"), btn=$("#saveTech");
  if(inp){ inp.value=localStorage.getItem("techName")||""; inp.addEventListener("blur",()=>localStorage.setItem("techName",(inp.value||"").trim()||"Técnico (anônimo)")); }
  if(btn){ btn.addEventListener("click",()=>{ const v=(inp?.value||"").trim()||"Técnico (anônimo)"; localStorage.setItem("techName",v); primeAudioOnce(); requestNotifPermission(); alert("Técnico definido!"); }); }

  // filtros estoque
  ["fVar","fLote","fFrom","fTo","fSaldo"].forEach(id=>{
    const el=document.getElementById(id); if(!el) return;
    const ev=(el.tagName==="INPUT" && (el.type==="text"||el.type==="date"))?"input":"change";
    el.addEventListener(ev,()=>loadEstoque());
  });
  $("#btnFiltrar")?.addEventListener("click",()=>loadEstoque());
  $("#btnLimpar")?.addEventListener("click",()=>{
    ["fVar","fLote","fFrom","fTo","fSaldo"].forEach(id=>{
      const el=document.getElementById(id); if(!el) return;
      if(el.type==="checkbox") el.checked=true; else el.value="";
    });
    loadEstoque();
  });
  // PDFs
  $("#btnPDFEntradas")?.addEventListener("click",()=>generatePDF("entradas"));
  $("#btnPDFSaidas")?.addEventListener("click",()=>generatePDF("saidas"));

  // carregamento inicial
  (async()=>{
    await loadCfg();
    await loadLotes();
    await loadTrat();
    await loadMov();
    await loadEstoque();
  })();
});

// ===== Navegação por abas =====
function setActiveTab(tabId){
  $$(".tab-btn").forEach(b=>b.classList.toggle("active", b.dataset.tab===tabId));
  $$(".tab").forEach(s=>s.classList.toggle("active", s.id===tabId));
  try{ history.replaceState(null,"",`#${tabId}`);}catch(e){}
}
$$(".tab-btn").forEach(btn=>btn.addEventListener("click",()=>setActiveTab(btn.dataset.tab)));
const firstTab=(location.hash||"").replace("#","")||"cadastro";
setActiveTab(firstTab);
