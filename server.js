import express from "express";
import cors from "cors";
import { LowSync } from "lowdb";
import { JSONFileSync } from "lowdb/node";
import { customAlphabet } from "nanoid";
import { z } from "zod";
import path from "path";
import fs from "fs";

const nanoid = customAlphabet("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz", 10);
const app = express();
app.use(cors());
app.use(express.json());

const DB_PATH = process.env.DB_PATH || "./db.json";
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const adapter = new JSONFileSync(DB_PATH);
const db = new LowSync(adapter, {
  settings: { units: { kg_per_sc: 60, kg_per_bag: 1000 } },
  seed_lots: [],
  treatments: [],
  movements: []
});
db.read(); db.write();

function toKg(qty, unit, settings){ if(unit==="kg") return qty; if(unit==="sc") return qty*(settings.units.kg_per_sc||60); if(unit==="bag") return qty*(settings.units.kg_per_bag||1000); throw new Error("Unidade inválida"); }
function fromKg(kg, unit, settings){ if(unit==="kg") return kg; if(unit==="sc") return kg/(settings.units.kg_per_sc||60); if(unit==="bag") return kg/(settings.units.kg_per_bag||1000); throw new Error("Unidade inválida"); }
function currentSettings(){ db.read(); return db.data.settings; }
function lotById(id){ db.read(); return db.data.seed_lots.find(l=>l.id===id); }
function usedKgInMovements(lot_id){ db.read(); return db.data.movements.filter(m=>m.lot_id===lot_id).reduce((a,m)=>a+(m.qty_kg||0),0); }
function treatedKg(lot_id){ db.read(); return db.data.treatments.filter(t=>t.lot_id===lot_id).reduce((a,t)=>a+(t.qty_kg||0),0); }

const lotSchema = z.object({ variety:z.string().min(1), supplier:z.string().min(1), lot_code:z.string().min(1), unit:z.enum(["kg","sc","bag"]), qty:z.number().positive(), received_at:z.string().min(1) });
const treatmentSchema = z.object({ lot_id:z.string().min(1), product:z.string().min(1), dose_per_100kg:z.number().nonnegative().default(0), operator:z.string().min(1), treated_at:z.string().min(1), unit:z.enum(["kg","sc","bag"]), qty:z.number().positive(), notes:z.string().optional() });
const movementSchema = z.object({ lot_id:z.string().min(1), destination_type:z.enum(["lavoura","fazenda"]), destination_name:z.string().min(1), unit:z.enum(["kg","sc","bag"]), qty:z.number().positive(), moved_at:z.string().min(1), notes:z.string().optional() });
const settingsSchema = z.object({ units:z.object({ kg_per_sc:z.number().positive(), kg_per_bag:z.number().positive() }) });

app.get("/api/status", (_req,res)=>res.json({ok:true,version:"1.4.1"}));
app.get("/api/settings", (_req,res)=>res.json(currentSettings()));
app.put("/api/settings", (req,res)=>{ const p=settingsSchema.safeParse(req.body); if(!p.success) return res.status(400).json(p.error); db.read(); db.data.settings=p.data; db.write(); res.json(db.data.settings); });

// LOTES
app.post("/api/seed-lots", (req,res)=>{
  const p=lotSchema.safeParse(req.body); if(!p.success) return res.status(400).json(p.error);
  const s=currentSettings(); const qty_kg=toKg(p.data.qty,p.data.unit,s);
  const lot={ id:nanoid(), ...p.data, qty_kg };
  db.read(); db.data.seed_lots.push(lot); db.write(); res.status(201).json(lot);
});
app.get("/api/seed-lots", (_req,res)=>{
  const s=currentSettings(); db.read();
  const lots=db.data.seed_lots.map(l=>{
    const used=usedKgInMovements(l.id);
    const balance_kg=Math.max(0,(l.qty_kg||0)-used);
    const treated_total_kg = treatedKg(l.id);
    const treated_available_kg = Math.max(0, treated_total_kg - used);
    return {...l, balance_kg, balance_sc:fromKg(balance_kg,"sc",s), balance_bag:fromKg(balance_kg,"bag",s), treated_total_kg, treated_available_kg};
  });
  res.json(lots);
});
app.put("/api/seed-lots/:id", (req, res) => {
  const id = req.params.id;
  db.read();
  const idx = db.data.seed_lots.findIndex(l => l.id === id);
  if (idx === -1) return res.status(404).json({ message: "Lote não encontrado" });

  const allowed = ["variety","supplier","lot_code","unit","qty","received_at"];
  const update = {};
  for (const k of allowed) if (k in req.body) update[k] = req.body[k];

  const s = currentSettings();
  const unit = update.unit ?? db.data.seed_lots[idx].unit;
  const qty  = update.qty  ?? db.data.seed_lots[idx].qty;
  const new_qty_kg = toKg(qty, unit, s);

  const already_moved = usedKgInMovements(id);
  if (new_qty_kg < already_moved - 1e-6) {
    return res.status(400).json({ message: "Novo volume do lote é menor do que o já enviado." });
  }

  db.data.seed_lots[idx] = { ...db.data.seed_lots[idx], ...update, qty: qty, unit: unit, qty_kg: new_qty_kg };
  db.write();
  res.json(db.data.seed_lots[idx]);
});
app.delete("/api/seed-lots/:id", (req, res) => {
  const id = req.params.id;
  db.read();
  const hasMov = db.data.movements.some(m => m.lot_id === id);
  const hasTrat = db.data.treatments.some(t => t.lot_id === id);
  if (hasMov || hasTrat) {
    return res.status(400).json({ message: "Não é possível excluir: existem tratamentos ou saídas vinculadas." });
  }
  const idx = db.data.seed_lots.findIndex(l => l.id === id);
  if (idx === -1) return res.status(404).json({ message: "Lote não encontrado" });
  const removed = db.data.seed_lots.splice(idx,1)[0];
  db.write();
  res.json({ ok:true, removed_id: removed.id });
});

// TRATAMENTOS
app.post("/api/treatments", (req,res)=>{
  const p=treatmentSchema.safeParse(req.body); if(!p.success) return res.status(400).json(p.error);
  const lot=lotById(p.data.lot_id); if(!lot) return res.status(404).json({message:"Lote não encontrado"});
  const s=currentSettings(); const qty_kg = toKg(p.data.qty, p.data.unit, s);
  const t={ id:nanoid(), ...p.data, qty_kg };
  db.read(); db.data.treatments.push(t); db.write();
  const lot_name = `${lot.variety} • ${lot.lot_code}`;
  res.status(201).json({ ...t, lot_name });
});
app.get("/api/treatments", (_req,res)=>{ 
  db.read(); 
  const data = db.data.treatments.map(t=>{
    const lot = lotById(t.lot_id);
    const lot_name = lot ? `${lot.variety} • ${lot.lot_code}` : t.lot_id;
    return { ...t, lot_name };
  });
  res.json(data); 
});
app.put("/api/treatments/:id", (req, res) => {
  const id = req.params.id;
  db.read();
  const idx = db.data.treatments.findIndex(t => t.id === id);
  if (idx === -1) return res.status(404).json({ message: "Tratamento não encontrado" });

  const allowed = ["lot_id","product","dose_per_100kg","operator","treated_at","unit","qty","notes"];
  const update = {};
  for (const k of allowed) if (k in req.body) update[k] = req.body[k];

  const s = currentSettings();
  const unit = update.unit ?? db.data.treatments[idx].unit;
  const qty  = update.qty  ?? db.data.treatments[idx].qty;
  const qty_kg = toKg(qty, unit, s);

  const lot_id = update.lot_id ?? db.data.treatments[idx].lot_id;
  const total_after = db.data.treatments
    .filter(t => t.id === id ? false : t.lot_id === lot_id)
    .reduce((a,t)=>a+(t.qty_kg||0),0) + qty_kg;

  const already_moved = usedKgInMovements(lot_id);
  if (already_moved > total_after + 1e-6) {
    return res.status(400).json({ message: "Edição deixaria saídas maiores que o volume tratado." });
  }

  db.data.treatments[idx] = { ...db.data.treatments[idx], ...update, qty_kg, lot_id };
  db.write();

  const lot = lotById(db.data.treatments[idx].lot_id);
  const lot_name = lot ? `${lot.variety} • ${lot.lot_code}` : db.data.treatments[idx].lot_id;
  res.json({ ...db.data.treatments[idx], lot_name });
});
app.delete("/api/treatments/:id", (req, res) => {
  const id = req.params.id;
  db.read();
  const idx = db.data.treatments.findIndex(t => t.id === id);
  if (idx === -1) return res.status(404).json({ message: "Tratamento não encontrado" });

  const t = db.data.treatments[idx];
  const lot_id = t.lot_id;

  const total_restante = db.data.treatments
    .filter(x => x.id !== id && x.lot_id === lot_id)
    .reduce((a,x)=>a+(x.qty_kg||0),0);
  const already_moved = usedKgInMovements(lot_id);
  if (already_moved > total_restante + 1e-6) {
    return res.status(400).json({ message: "Exclusão impediria cobrir as saídas já realizadas para esse lote." });
  }

  db.data.treatments.splice(idx,1);
  db.write();
  res.json({ ok:true });
});

// MOVIMENTOS
app.post("/api/movements", (req,res)=>{
  const p=movementSchema.safeParse(req.body); if(!p.success) return res.status(400).json(p.error);
  const lot=lotById(p.data.lot_id); if(!lot) return res.status(404).json({message:"Lote não encontrado"});
  const s=currentSettings(); const qty_kg=toKg(p.data.qty,p.data.unit,s);

  const treated_total = treatedKg(lot.id);
  const already_moved = usedKgInMovements(lot.id);
  const treated_available = Math.max(0, treated_total - already_moved);

  if(qty_kg > treated_available + 1e-6) return res.status(400).json({message:"Quantidade requisitada ultrapassa o volume TRATADO disponível do lote."});
  if(qty_kg > (lot.qty_kg - already_moved) + 1e-6) return res.status(400).json({message:"Quantidade requisitada ultrapassa o saldo total do lote."});

  const m={ id:nanoid(), ...p.data, qty_kg }; db.read(); db.data.movements.push(m); db.write(); res.status(201).json(m);
});
app.get("/api/movements", (_req,res)=>{ db.read(); res.json(db.data.movements); });
app.put("/api/movements/:id", (req, res) => {
  const id = req.params.id;
  db.read();
  const idx = db.data.movements.findIndex(m => m.id === id);
  if (idx === -1) return res.status(404).json({ message: "Movimentação não encontrada" });

  const allowed = ["lot_id","destination_type","destination_name","unit","qty","moved_at","notes"];
  const update = {};
  for (const k of allowed) if (k in req.body) update[k] = req.body[k];

  const s = currentSettings();
  const unit = update.unit ?? db.data.movements[idx].unit;
  const qty  = update.qty  ?? db.data.movements[idx].qty;
  const lot_id = update.lot_id ?? db.data.movements[idx].lot_id;

  const used_without_this = db.data.movements
    .filter(m => !(m.id === id) && m.lot_id === lot_id)
    .reduce((a,m)=>a+(m.qty_kg||0),0);

  const qty_kg = toKg(qty, unit, s);

  const treated_total = treatedKg(lot_id);
  const treated_available = treated_total - used_without_this;
  if (qty_kg > treated_available + 1e-6) {
    return res.status(400).json({ message: "Quantidade ultrapassa o TRATADO disponível do lote." });
  }

  const lot = lotById(lot_id);
  if (!lot) return res.status(404).json({ message: "Lote não encontrado" });
  const total_available = (lot.qty_kg || 0) - used_without_this;
  if (qty_kg > total_available + 1e-6) {
    return res.status(400).json({ message: "Quantidade ultrapassa o saldo total do lote." });
  }

  db.data.movements[idx] = { ...db.data.movements[idx], ...update, qty_kg, lot_id };
  db.write();
  res.json(db.data.movements[idx]);
});
app.delete("/api/movements/:id", (req, res) => {
  const id = req.params.id;
  db.read();
  const idx = db.data.movements.findIndex(m => m.id === id);
  if (idx === -1) return res.status(404).json({ message: "Movimentação não encontrada" });
  db.data.movements.splice(idx,1);
  db.write();
  res.json({ ok:true });
});

app.get("/api/inventory", (_req,res)=>{
  // (Mantido o agregado por variedade caso queira usar depois)
  const s=currentSettings(); db.read(); const byVariety={};
  for(const lot of db.data.seed_lots){ const used=usedKgInMovements(lot.id); const bal=Math.max(0,(lot.qty_kg||0)-used); byVariety[lot.variety]=(byVariety[lot.variety]||0)+bal; }
  const result=Object.entries(byVariety).map(([variety,kg])=>({ variety, kg, sc:kg/(s.units.kg_per_sc||60), bag:kg/(s.units.kg_per_bag||1000) }));
  res.json(result);
});

app.use(express.static("public"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log(`Servidor rodando na porta ${PORT}`));
