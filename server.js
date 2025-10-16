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

/* ===== DB ===== */
const DB_PATH = process.env.DB_PATH || "./db.json";
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const adapter = new JSONFileSync(DB_PATH);
const db = new LowSync(adapter, {
  settings: { units: { kg_per_sc: 60, kg_per_bag: 1000 } },
  seed_lots: [],      // {id, variety, supplier, lot_code, unit, qty, qty_kg, received_at}
  treatments: [],     // {id, lot_id, product, dose_per_100kg, operator, treated_at, unit, qty, qty_kg, notes}
  movements: []       // {id, lot_id, destination_type, destination_name, unit, qty, qty_kg, moved_at, notes}
});
db.read(); db.write();

/* ===== Helpers ===== */
function toKg(qty, unit, settings){
  if (unit === "kg") return qty;
  if (unit === "sc") return qty * (settings.units.kg_per_sc || 60);
  if (unit === "bag") return qty * (settings.units.kg_per_bag || 1000);
  throw new Error("Unidade inválida");
}
function fromKg(kg, unit, settings){
  if (unit === "kg") return kg;
  if (unit === "sc") return kg / (settings.units.kg_per_sc || 60);
  if (unit === "bag") return kg / (settings.units.kg_per_bag || 1000);
  throw new Error("Unidade inválida");
}
function currentSettings(){ db.read(); return db.data.settings; }
function lotById(id){ db.read(); return db.data.seed_lots.find(l => l.id === id); }
function usedKgInMovements(lot_id){
  db.read();
  return db.data.movements
    .filter(m => m.lot_id === lot_id)
    .reduce((a, m) => a + (m.qty_kg || 0), 0);
}
/* total já tratado em kg para um lote */
function treatedKg(lot_id){
  db.read();
  return db.data.treatments
    .filter(t => t.lot_id === lot_id)
    .reduce((a, t) => a + (t.qty_kg || 0), 0);
}

/* ===== Schemas ===== */
const lotSchema = z.object({
  variety: z.string().min(1),
  supplier: z.string().min(1),
  lot_code: z.string().min(1),
  unit: z.enum(["kg","sc","bag"]),
  qty: z.number().positive(),
  received_at: z.string().min(1)
});

/* tratamento PARCIAL: precisa de unit e qty */
const treatmentSchema = z.object({
  lot_id: z.string().min(1),
  product: z.string().min(1),
  dose_per_100kg: z.number().nonnegative().default(0),
  operator: z.string().min(1),
  treated_at: z.string().min(1),
  unit: z.enum(["kg","sc","bag"]),
  qty: z.number().positive(),
  notes: z.string().optional()
});

const movementSchema = z.object({
  lot_id: z.string().min(1),
  destination_type: z.enum(["lavoura","fazenda"]),
  destination_name: z.string().min(1),
  unit: z.enum(["kg","sc","bag"]),
  qty: z.number().positive(),
  moved_at: z.string().min(1),
  notes: z.string().optional()
});

const settingsSchema = z.object({
  units: z.object({ kg_per_sc: z.number().positive(), kg_per_bag: z.number().positive() })
});

/* ===== API ===== */
app.get("/api/status", (_req,res) => res.json({ ok:true, version:"1.2.0" }));

app.get("/api/settings", (_req,res) => res.json(currentSettings()));

app.put("/api/settings", (req,res) => {
  const p = settingsSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error);
  db.read(); db.data.settings = p.data; db.write();
  res.json(db.data.settings);
});

/* lotes */
app.post("/api/seed-lots", (req,res) => {
  const p = lotSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error);
  const s = currentSettings();
  const qty_kg = toKg(p.data.qty, p.data.unit, s);
  const lot = { id: nanoid(), ...p.data, qty_kg };
  db.read(); db.data.seed_lots.push(lot); db.write();
  res.status(201).json(lot);
});

app.get("/api/seed-lots", (_req,res) => {
  const s = currentSettings(); db.read();
  const lots = db.data.seed_lots.map(l => {
    const used = usedKgInMovements(l.id);
    const balance_kg = Math.max(0, (l.qty_kg || 0) - used);
    const treated_total_kg = treatedKg(l.id);
    const treated_available_kg = Math.max(0, treated_total_kg - used);
    return {
      ...l,
      balance_kg,
      balance_sc: fromKg(balance_kg, "sc", s),
      balance_bag: fromKg(balance_kg, "bag", s),
      treated_total_kg,
      treated_available_kg
    };
  });
  res.json(lots);
});

/* tratamentos (parciais) */
app.post("/api/treatments", (req,res) => {
  const p = treatmentSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error);

  const lot = lotById(p.data.lot_id);
  if (!lot) return res.status(404).json({ message: "Lote não encontrado" });

  const s = currentSettings();
  const qty_kg = toKg(p.data.qty, p.data.unit, s);

  const t = { id: nanoid(), ...p.data, qty_kg };
  db.read(); db.data.treatments.push(t); db.write();

  const lot_name = `${lot.variety} • ${lot.lot_code}`;
  res.status(201).json({ ...t, lot_name });
});

/* GET tratamentos inclui lot_name para não aparecer ID */
app.get("/api/treatments", (_req,res) => {
  db.read();
  const data = db.data.treatments.map(t => {
    const lot = lotById(t.lot_id);
    const lot_name = lot ? `${lot.variety} • ${lot.lot_code}` : t.lot_id;
    return { ...t, lot_name };
  });
  res.json(data);
});

/* saídas: só libera do volume TRATADO disponível */
app.post("/api/movements", (req,res) => {
  const p = movementSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error);

  const lot = lotById(p.data.lot_id);
  if (!lot) return res.status(404).json({ message: "Lote não encontrado" });

  const s = currentSettings();
  const qty_kg = toKg(p.data.qty, p.data.unit, s);

  const treated_total = treatedKg(lot.id);
  const already_moved = usedKgInMovements(lot.id);
  const treated_available = Math.max(0, treated_total - already_moved);

  if (qty_kg > treated_available + 1e-6) {
    return res.status(400).json({ message: "Quantidade requisitada ultrapassa o volume TRATADO disponível do lote." });
  }
  if (qty_kg > (lot.qty_kg - already_moved) + 1e-6) {
    return res.status(400).json({ message: "Quantidade requisitada ultrapassa o saldo total do lote." });
  }

  const m = { id: nanoid(), ...p.data, qty_kg };
  db.read(); db.data.movements.push(m); db.write();
  res.status(201).json(m);
});

app.get("/api/movements", (_req,res) => { db.read(); res.json(db.data.movements); });

/* estoque consolidado por variedade (em kg + convertidos) */
app.get("/api/inventory", (_req,res) => {
  const s = currentSettings(); db.read();
  const byVariety = {};
  for (const lot of db.data.seed_lots) {
    const used = usedKgInMovements(lot.id);
    const bal = Math.max(0, (lot.qty_kg || 0) - used);
    byVariety[lot.variety] = (byVariety[lot.variety] || 0) + bal;
  }
  const result = Object.entries(byVariety).map(([variety, kg]) => ({
    variety,
    kg,
    sc: fromKg(kg, "sc", s),
    bag: fromKg(kg, "bag", s)
  }));
  res.json(result);
});

/* static */
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
