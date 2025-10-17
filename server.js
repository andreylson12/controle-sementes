// server.js (ESM)
// Requisitos: Node 18+, "type":"module" no package.json, lowdb v6+, socket.io

import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";

import { LowSync } from "lowdb";
import { JSONFileSync } from "lowdb/node";
import { customAlphabet } from "nanoid";

// ===== util =====
const nanoid = customAlphabet(
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz",
  10
);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===== app/socket =====
const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());

// Identifica o técnico pelo header x-user (ou body.by)
app.use((req, _res, next) => {
  req.userName =
    req.header("x-user") || (req.body && req.body.by) || "Técnico (anônimo)";
  next();
});

// ===== DB (lowdb) =====
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "db.json");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const adapter = new JSONFileSync(DB_PATH);
const db = new LowSync(adapter, {
  settings: { units: { kg_per_sc: 60, kg_per_bag: 1000 } },
  seed_lots: [],
  treatments: [],
  movements: [],
  events: [],
});
db.read();
db.write();

const currentSettings = () => {
  db.read();
  return db.data.settings || { units: { kg_per_sc: 60, kg_per_bag: 1000 } };
};

function toKg(qty, unit, s) {
  if (unit === "kg") return Number(qty || 0);
  if (unit === "sc") return Number(qty || 0) * (s.units.kg_per_sc || 60);
  if (unit === "bag") return Number(qty || 0) * (s.units.kg_per_bag || 1000);
  throw new Error("Unidade inválida");
}
function lotById(id) {
  db.read();
  return db.data.seed_lots.find((l) => l.id === id);
}
function usedKgInMovements(lot_id) {
  db.read();
  return db.data.movements
    .filter((m) => m.lot_id === lot_id)
    .reduce((a, m) => a + Number(m.qty_kg || 0), 0);
}
function treatedKg(lot_id) {
  db.read();
  return db.data.treatments
    .filter((t) => t.lot_id === lot_id)
    .reduce((a, t) => a + Number(t.qty_kg || 0), 0);
}

function pushUpdate(type, extra = {}) {
  io.emit("data:update", { type, ...extra, ts: Date.now() });
}

// ===== Auditoria / Alarmes =====
function addEvent({ by, entity, action, ref_id, details = {} }) {
  db.read();
  const ev = {
    id: nanoid(),
    when: new Date().toISOString(),
    by,
    entity,
    action,
    ref_id,
    details,
  };
  db.data.events.push(ev);
  db.write();
  return ev;
}
function emitAlarm(ev) {
  const msg = `[${new Date(ev.when).toLocaleString()}] ${ev.by} ${ev.action} ${ev.entity} (${ev.ref_id})`;
  io.emit("alarm", { ...ev, message: msg });
}

// ===== Rotas básicas =====
app.get("/api/status", (_req, res) =>
  res.json({ ok: true, version: "1.6.0" })
);

app.get("/api/settings", (_req, res) => res.json(currentSettings()));

app.put("/api/settings", (req, res) => {
  db.read();
  db.data.settings = req.body || db.data.settings;
  db.write();
  pushUpdate("settings");
  const ev = addEvent({
    by: req.userName,
    entity: "settings",
    action: "update",
    ref_id: "settings",
    details: db.data.settings,
  });
  emitAlarm(ev);
  res.json(db.data.settings);
});

// ===== LOTES =====
app.post("/api/seed-lots", (req, res) => {
  const p = req.body;
  const s = currentSettings();
  const qty_kg = toKg(p.qty, p.unit, s);
  const lot = {
    id: nanoid(),
    variety: p.variety,
    supplier: p.supplier,
    lot_code: p.lot_code,
    unit: p.unit,
    qty: p.qty,
    qty_kg,
    received_at: p.received_at,
  };
  db.read();
  db.data.seed_lots.push(lot);
  db.write();
  pushUpdate("lots");

  const ev = addEvent({
    by: req.userName,
    entity: "lot",
    action: "create",
    ref_id: lot.id,
    details: { variety: lot.variety, lot_code: lot.lot_code },
  });
  emitAlarm(ev);

  res.status(201).json(lot);
});

app.get("/api/seed-lots", (_req, res) => {
  db.read();
  const s = currentSettings();
  const kgPerSc = s.units.kg_per_sc || 60;
  const kgPerBag = s.units.kg_per_bag || 1000;

  const rows = db.data.seed_lots.map((l) => {
    const entrada_kg = Number(l.qty_kg || 0);
    const saida_kg = Number(usedKgInMovements(l.id) || 0);
    const saldo_kg = Math.max(0, entrada_kg - saida_kg);
    const tratado_kg = treatedKg(l.id);

    return {
      ...l,
      entrada_kg,
      entrada_sc: entrada_kg / kgPerSc,
      entrada_bag: entrada_kg / kgPerBag,
      saida_kg,
      saida_sc: saida_kg / kgPerSc,
      saida_bag: saida_kg / kgPerBag,
      balance_kg: saldo_kg,
      balance_sc: saldo_kg / kgPerSc,
      balance_bag: saldo_kg / kgPerBag,
      treated_kg: tratado_kg,
      treated_sc: tratado_kg / kgPerSc,
      treated_bag: tratado_kg / kgPerBag,
    };
  });

  res.json(rows);
});

app.put("/api/seed-lots/:id", (req, res) => {
  const id = req.params.id;
  db.read();
  const idx = db.data.seed_lots.findIndex((l) => l.id === id);
  if (idx === -1) return res.status(404).json({ message: "Lote não encontrado" });

  const s = currentSettings();
  const unit = req.body.unit ?? db.data.seed_lots[idx].unit;
  const qty = req.body.qty ?? db.data.seed_lots[idx].qty;
  const new_qty_kg = toKg(qty, unit, s);

  const already_moved = usedKgInMovements(id);
  if (new_qty_kg < already_moved - 1e-6) {
    return res
      .status(400)
      .json({ message: "Novo volume menor que saídas já realizadas." });
  }

  db.data.seed_lots[idx] = {
    ...db.data.seed_lots[idx],
    ...req.body,
    qty,
    unit,
    qty_kg: new_qty_kg,
  };
  db.write();
  pushUpdate("lots");

  const ev = addEvent({
    by: req.userName,
    entity: "lot",
    action: "update",
    ref_id: id,
    details: {
      variety: db.data.seed_lots[idx].variety,
      lot_code: db.data.seed_lots[idx].lot_code,
    },
  });
  emitAlarm(ev);

  res.json(db.data.seed_lots[idx]);
});

app.delete("/api/seed-lots/:id", (req, res) => {
  const id = req.params.id;
  db.read();

  const hasMov = db.data.movements.some((m) => m.lot_id === id);
  const hasTrat = db.data.treatments.some((t) => t.lot_id === id);
  if (hasMov || hasTrat)
    return res
      .status(400)
      .json({
        message:
          "Não é possível excluir: existem tratamentos ou saídas vinculadas.",
      });

  const idx = db.data.seed_lots.findIndex((l) => l.id === id);
  if (idx === -1) return res.status(404).json({ message: "Lote não encontrado" });

  const removed = db.data.seed_lots.splice(idx, 1)[0];
  db.write();
  pushUpdate("lots");

  const ev = addEvent({
    by: req.userName,
    entity: "lot",
    action: "delete",
    ref_id: removed.id,
  });
  emitAlarm(ev);

  res.json({ ok: true, removed_id: removed.id });
});

// ===== TRATAMENTOS =====
app.post("/api/treatments", (req, res) => {
  const p = req.body;
  const lot = lotById(p.lot_id);
  if (!lot) return res.status(404).json({ message: "Lote não encontrado" });

  const s = currentSettings();
  const qty_kg = toKg(p.qty, p.unit, s);

  const t = { id: nanoid(), ...p, qty_kg };
  db.read();
  db.data.treatments.push(t);
  db.write();
  pushUpdate("treatments");
  pushUpdate("lots");

  const ev = addEvent({
    by: req.userName,
    entity: "treatment",
    action: "create",
    ref_id: t.id,
    details: { lot_id: t.lot_id, product: t.product },
  });
  emitAlarm(ev);

  const lot_name = `${lot.variety} • ${lot.lot_code}`;
  res.status(201).json({ ...t, lot_name });
});

app.get("/api/treatments", (_req, res) => {
  db.read();
  const list = db.data.treatments.map((t) => {
    const lot = lotById(t.lot_id);
    const lot_name = lot ? `${lot.variety} • ${lot.lot_code}` : t.lot_id;
    return { ...t, lot_name };
  });
  res.json(list);
});

app.put("/api/treatments/:id", (req, res) => {
  const id = req.params.id;
  db.read();
  const idx = db.data.treatments.findIndex((t) => t.id === id);
  if (idx === -1)
    return res.status(404).json({ message: "Tratamento não encontrado" });

  const s = currentSettings();
  const unit = req.body.unit ?? db.data.treatments[idx].unit;
  const qty = req.body.qty ?? db.data.treatments[idx].qty;
  const qty_kg = toKg(qty, unit, s);
  const lot_id = req.body.lot_id ?? db.data.treatments[idx].lot_id;

  // Checa consistência com saídas existentes
  const total_after =
    db.data.treatments
      .filter((x) => x.id !== id && x.lot_id === lot_id)
      .reduce((a, x) => a + (x.qty_kg || 0), 0) + qty_kg;

  const already_moved = usedKgInMovements(lot_id);
  if (already_moved > total_after + 1e-6) {
    return res
      .status(400)
      .json({
        message:
          "Edição deixaria saídas maiores que o volume tratado disponível.",
      });
  }

  db.data.treatments[idx] = {
    ...db.data.treatments[idx],
    ...req.body,
    qty_kg,
    lot_id,
  };
  db.write();
  pushUpdate("treatments");
  pushUpdate("lots");

  const ev = addEvent({
    by: req.userName,
    entity: "treatment",
    action: "update",
    ref_id: id,
    details: { lot_id, product: db.data.treatments[idx].product },
  });
  emitAlarm(ev);

  const lot = lotById(lot_id);
  const lot_name = lot ? `${lot.variety} • ${lot.lot_code}` : lot_id;
  res.json({ ...db.data.treatments[idx], lot_name });
});

app.delete("/api/treatments/:id", (req, res) => {
  const id = req.params.id;
  db.read();
  const idx = db.data.treatments.findIndex((t) => t.id === id);
  if (idx === -1)
    return res.status(404).json({ message: "Tratamento não encontrado" });

  const t = db.data.treatments[idx];
  const lot_id = t.lot_id;

  const total_restante = db.data.treatments
    .filter((x) => x.id !== id && x.lot_id === lot_id)
    .reduce((a, x) => a + (x.qty_kg || 0), 0);

  const already_moved = usedKgInMovements(lot_id);
  if (already_moved > total_restante + 1e-6) {
    return res
      .status(400)
      .json({
        message:
          "Exclusão impediria cobrir as saídas já realizadas para esse lote.",
      });
  }

  db.data.treatments.splice(idx, 1);
  db.write();
  pushUpdate("treatments");
  pushUpdate("lots");

  const ev = addEvent({
    by: req.userName,
    entity: "treatment",
    action: "delete",
    ref_id: id,
    details: { lot_id },
  });
  emitAlarm(ev);

  res.json({ ok: true });
});

// ===== MOVIMENTOS (Saídas) =====
app.post("/api/movements", (req, res) => {
  const p = req.body;
  const lot = lotById(p.lot_id);
  if (!lot) return res.status(404).json({ message: "Lote não encontrado" });

  const s = currentSettings();
  const qty_kg = toKg(p.qty, p.unit, s);

  const treated_total = treatedKg(lot.id);
  const already_moved = usedKgInMovements(lot.id);

  const treated_available = Math.max(0, treated_total - already_moved);
  if (qty_kg > treated_available + 1e-6)
    return res
      .status(400)
      .json({ message: "Quantidade ultrapassa o TRATADO disponível." });

  if (qty_kg > (lot.qty_kg - already_moved) + 1e-6)
    return res
      .status(400)
      .json({ message: "Quantidade ultrapassa o saldo total do lote." });

  const m = { id: nanoid(), ...p, qty_kg };
  db.read();
  db.data.movements.push(m);
  db.write();
  pushUpdate("movements");
  pushUpdate("lots");

  const ev = addEvent({
    by: req.userName,
    entity: "movement",
    action: "create",
    ref_id: m.id,
    details: { lot_id: m.lot_id, destination: m.destination_name },
  });
  emitAlarm(ev);

  res.status(201).json(m);
});

app.get("/api/movements", (_req, res) => {
  db.read();
  const list = db.data.movements
    .slice()
    .sort((a, b) => String(a.moved_at).localeCompare(String(b.moved_at)));
  res.json(list);
});

app.put("/api/movements/:id", (req, res) => {
  const id = req.params.id;
  db.read();
  const idx = db.data.movements.findIndex((m) => m.id === id);
  if (idx === -1)
    return res.status(404).json({ message: "Movimentação não encontrada" });

  const s = currentSettings();
  const unit = req.body.unit ?? db.data.movements[idx].unit;
  const qty = req.body.qty ?? db.data.movements[idx].qty;
  const lot_id = req.body.lot_id ?? db.data.movements[idx].lot_id;
  const qty_kg = toKg(qty, unit, s);

  // Saídas sem a atual
  const used_without_this = db.data.movements
    .filter((x) => x.id !== id && x.lot_id === lot_id)
    .reduce((a, x) => a + (x.qty_kg || 0), 0);

  // Checagens
  const treated_total = treatedKg(lot_id);
  if (qty_kg > treated_total - used_without_this + 1e-6)
    return res
      .status(400)
      .json({ message: "Quantidade ultrapassa o tratado disponível" });

  const lot = lotById(lot_id);
  if (!lot) return res.status(404).json({ message: "Lote não encontrado" });

  const total_available = (lot.qty_kg || 0) - used_without_this;
  if (qty_kg > total_available + 1e-6)
    return res
      .status(400)
      .json({ message: "Quantidade ultrapassa o saldo total do lote." });

  db.data.movements[idx] = {
    ...db.data.movements[idx],
    ...req.body,
    qty_kg,
    lot_id,
  };
  db.write();
  pushUpdate("movements");
  pushUpdate("lots");

  const ev = addEvent({
    by: req.userName,
    entity: "movement",
    action: "update",
    ref_id: id,
    details: {
      lot_id: db.data.movements[idx].lot_id,
      destination: db.data.movements[idx].destination_name,
    },
  });
  emitAlarm(ev);

  res.json(db.data.movements[idx]);
});

app.delete("/api/movements/:id", (req, res) => {
  const id = req.params.id;
  db.read();
  const idx = db.data.movements.findIndex((m) => m.id === id);
  if (idx === -1)
    return res.status(404).json({ message: "Movimentação não encontrada" });

  db.data.movements.splice(idx, 1);
  db.write();
  pushUpdate("movements");
  pushUpdate("lots");

  const ev = addEvent({
    by: req.userName,
    entity: "movement",
    action: "delete",
    ref_id: id,
  });
  emitAlarm(ev);

  res.json({ ok: true });
});

// ===== Eventos (auditoria) =====
app.get("/api/events", (req, res) => {
  db.read();
  const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
  const items = [...db.data.events].reverse().slice(0, limit);
  res.json(items);
});

// ===== static =====
app.use(express.static(path.join(__dirname, "public")));

// ===== start =====
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log("Servidor na porta", PORT);
});
