# Controle de Sementes (Fazenda)

Sistema simples para controle de sementes de soja (ou outras), com:
- Entrada de lotes em **kg**, **sc** (sacas, padrão 60 kg) e **bag** (padrão 1000 kg)
- **Tratamento obrigatório** antes da saída
- Saída para **lavoura** ou **fazenda**
- Conversões automáticas de unidades com configuração
- Estoque consolidado por variedade

## Stack
- Node.js + Express (ESM)
- **lowdb** (arquivo JSON) — ideal para começar
- Front-end estático (HTML + JS) consumindo a API

> **Observação sobre persistência:** Em produção na Railway, crie um **Volume** e aponte a variável `DB_PATH` para o local montado (ex.: `/data/db.json`). Assim seus dados persistem entre deploys.

## Rodando localmente (opcional)
Se quiser testar local (não é obrigatório):
```bash
npm install
npm start
# abra http://localhost:3000
```

## Deploy na **Railway**
1. Faça o upload deste projeto no GitHub.
2. Na Railway, crie um **New Project** > **Deploy from GitHub Repo** e selecione este repositório.
3. Em **Variables** adicione (opcional, mas recomendado):
   - `DB_PATH` = `/data/db.json`
4. Em **Volumes**, crie um **Volume** e monte em `/data` no seu serviço.
5. A Railway detecta Node e usa `npm start` automaticamente. Certifique-se que a porta esteja em `PORT` (padrão do código).
6. Acesse a URL pública do serviço.

## Endpoints principais
- `GET /api/status` — status do serviço
- `GET /api/settings` — ver conversões
- `PUT /api/settings` — salvar conversões `{ "units": { "kg_per_sc": 60, "kg_per_bag": 1000 } }`
- `POST /api/seed-lots` — criar lote
- `GET /api/seed-lots` — listar lotes com saldo
- `POST /api/treatments` — criar tratamento (marca o lote como tratado)
- `GET /api/treatments` — listar tratamentos
- `POST /api/movements` — registrar saída (valida tratamento e saldo)
- `GET /api/movements` — listar movimentações
- `GET /api/inventory` — estoque consolidado por variedade

### Exemplo `POST /api/seed-lots`
```json
{
  "variety": "Soja BRS XYZ",
  "supplier": "Cooperativa ABC",
  "lot_code": "L2025-001",
  "unit": "sc",
  "qty": 100,
  "received_at": "2025-10-10"
}
```

### Exemplo `POST /api/treatments`
```json
{
  "lot_id": "ID_DO_LOTE",
  "product": "Inseticida T",
  "dose_per_100kg": 2.5,
  "operator": "João",
  "treated_at": "2025-10-12",
  "notes": "Padrão do agrônomo"
}
```

### Exemplo `POST /api/movements`
```json
{
  "lot_id": "ID_DO_LOTE",
  "destination_type": "lavoura",
  "destination_name": "Talhão 05",
  "unit": "kg",
  "qty": 1200,
  "moved_at": "2025-10-14",
  "notes": "Plantio direto"
}
```

## Ajustes comuns
- **Saca diferente de 60 kg?** Vá em *Configurações* e altere para o valor desejado.
- **Bag com peso diferente?** Altere o valor padrão do big bag em *Configurações*.
- **Campos extras** (germinação, poder de sementes, etc.) podem ser adicionados nos schemas do `server.js`.

## Licença
MIT
