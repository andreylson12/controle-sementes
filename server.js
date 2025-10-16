import express from "express";
import cors from "cors";
import { JSONFileSync, LowSync } from "lowdb";
import { customAlphabet } from "nanoid";
import { z } from "zod";
import path from "path";
import fs from "fs";

const nanoid = customAlphabet("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz", 10);
const app = express();
app.use(cors());
app.use(express.json());

// ===== DB SETUP =====
const DB_PATH = process.env.DB_PATH || "./db.json";
// Ensure dir exists
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const adapter = new JSONFileSync(DB_PATH);
const db = new LowSync(adapter, {
  settings: {
    units: {
      // Conversões base kg
      kg_per_sc: 60,     // 1 saca = 60 kg (padrão soja no Brasil)
      kg_per_bag: 1000   // 1 big bag = 1000 kg (ajuste conforme sua realidade)
    }
  },
  seed_lots: [],    // {id, variety, supplier, lot_code, unit, qty, qty_kg, received_at, treated: bool}
  treatments: [],   // {id, lot_id, product, dose_per_100kg, operator, treated_at, notes}
  movements: []     // {id, lot_id, destination_type, destination_name, unit, qty, qty_kg, moved_at, notes}
});
db.read();
db.write();

// ===== Helpers =====
function toKg(qty, unit, settings) {
  if (unit === "kg") return qty;
  if (unit === "sc") return qty * (settings.units.kg_per_sc || 60);
  if (unit === "bag") return qty * (settings.units.kg_per_bag || 1000);
  throw new Error("Unidade inválida");
}

function fromKg(kg, unit, settings) {
  if (unit === "kg") return kg;
  if (unit === "sc") return kg / (settings.units.kg_per_sc || 60);
  if (unit === "bag") return kg / (settings.units.kg_per_bag || 1000);
  throw new Error("Unidade inválida");
}

function currentSettings() {
  db.read();
  return db.data.settings;
}

function lotById(id) {
  db.read();
  return db.data.seed_lots.find(l => l.id === id);
}

function usedKgInMovements(lot_id) {
  db.read();
  return db.data.movements
    .filter(m => m.lot_id === lot_id)
    .reduce((acc, m) => acc + (m.qty_kg || 0), 0);
}

// ===== Schemas =====
const lotSchema = z.object({
  variety: z.string().min(1),
  supplier: z.string().min(1),
  lot_code: z.string().min(1),
  unit: z.enum(["kg","sc","bag"]),
  qty: z.number().positive(),
  received_at: z.string().min(1)
});

const treatmentSchema = z.object({
  lot_id: z.string().min(1),
  product: z.string().min(1),
  dose_per_100kg: z.number().nonnegative().default(0),
  operator: z.string().min(1),
  treated_at: z.string().min(1),
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
  units: z.object({
    kg_per_sc: z.number().positive(),
    kg_per_bag: z.number().positive()
  })
});

// ===== API =====
app.get("/api/status", (_req, res) => {
  res.json({ ok: true, version: "1.0.0" });
});

app.get("/api/settings", (_req, res) => {
  res.json(currentSettings());
});

app.put("/api/settings", (req, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error);
  db.read();
  db.data.settings = parsed.data;
  db.write();
  res.json(db.data.settings);
});

app.post("/api/seed-lots", (req, res) => {
  const parsed = lotSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error);
  const s = currentSettings();
  const qty_kg = toKg(parsed.data.qty, parsed.data.unit, s);
  const lot = {
    id: nanoid(),
    ...parsed.data,
    qty_kg,
    treated: false
  };
  db.read();
  db.data.seed_lots.push(lot);
  db.write();
  res.status(201).json(lot);
});

app.get("/api/seed-lots", (_req, res) => {
  db.read();
  // calcula saldo disponível (kg) por lote
  const s = currentSettings();
  const lotsWithBalance = db.data.seed_lots.map(l => {
    const used = usedKgInMovements(l.id);
    const balance_kg = Math.max(0, (l.qty_kg || 0) - used);
    return {
      ...l,
      balance_kg,
      balance_sc: fromKg(balance_kg, "sc", s),
      balance_bag: fromKg(balance_kg, "bag", s)
    };
  });
  res.json(lotsWithBalance);
});

app.post("/api/treatments", (req, res) => {
  const parsed = treatmentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error);
  const lot = lotById(parsed.data.lot_id);
  if (!lot) return res.status(404).json({ message: "Lote não encontrado" });

  const treatment = { id: nanoid(), ...parsed.data };
  db.read();
  db.data.treatments.push(treatment);
  // marca o lote como tratado
  const idx = db.data.seed_lots.findIndex(l => l.id === lot.id);
  db.data.seed_lots[idx].treated = true;
  db.write();
  res.status(201).json(treatment);
});

app.get("/api/treatments", (_req, res) => {
  db.read();
  res.json(db.data.treatments);
});

app.post("/api/movements", (req, res) => {
  const parsed = movementSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error);
  const lot = lotById(parsed.data.lot_id);
  if (!lot) return res.status(404).json({ message: "Lote não encontrado" });
  if (!lot.treated) return res.status(400).json({ message: "Lote ainda não foi tratado. Trate antes de enviar." });

  const s = currentSettings();
  const qty_kg = toKg(parsed.data.qty, parsed.data.unit, s);
  const used = usedKgInMovements(lot.id);
  const available = (lot.qty_kg || 0) - used;
  if (qty_kg > available + 1e-6) {
    return res.status(400).json({ message: "Quantidade solicitada ultrapassa o saldo do lote." });
  }

  const movement = { id: nanoid(), ...parsed.data, qty_kg };
  db.read();
  db.data.movements.push(movement);
  db.write();
  res.status(201).json(movement);
});

app.get("/api/movements", (_req, res) => {
  db.read();
  res.json(db.data.movements);
});

app.get("/api/inventory", (_req, res) => {
  db.read();
  const s = currentSettings();
  // estoque disponível por variedade (kg e convertido)
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

// ===== Static Frontend =====
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
