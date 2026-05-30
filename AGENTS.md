# AGENTS.md — Bot Comida

> Guía para agentes de IA (y humanos nuevos) que trabajan en este repo.
> Mapea **dónde está cada cosa**, **cómo se conecta** y **dónde están las trampas**.
> Convención estándar leída por Claude Code, Cursor, Copilot, etc.

## Qué es

Bot de pedidos por **WhatsApp** para restaurantes pequeños, **multi-tenant**. El dueño
sube un `menu.xlsx`; el bot atiende clientes por WhatsApp (vía Twilio), toma pedidos con
una **máquina de estados** y los guarda en SQLite. Cuando no entiende, usa **Claude Haiku
4.5** como fallback. Si la conversación se traba, se **pausa** (handoff) y el dueño la
retoma desde un **panel web**.

- **Bot** (este repo) → desplegado en **Railway**.
- **Panel** (`panel/`) → desplegado en **Vercel** (HTML estático que pega a la API del bot).

## Comandos

```bash
npm install          # instalar deps (Node >= 20)
npm run dev          # desarrollo con nodemon (server.js)
npm start            # producción (node server.js)
node src/db/test-db.js              # script manual de prueba de DB
node src/bot/test-conversation.js   # script manual de prueba del motor
```
No hay test runner (Jest/Vitest) ni linter configurado. Las "pruebas" son scripts manuales.

## Flujo de un mensaje (el camino crítico)

```
WhatsApp del cliente
  → Twilio  → POST /webhook
      └─ src/routes/webhook.js
           · extrae From (phone), To (destNumber), Body
           · rechaza media (NumMedia>0) y mensajes vacíos
           · getTenantByNumber(destNumber)  ← resuelve el tenant por el número destino
           · processMessage(tenant.id, phone, body)
                └─ src/bot/engine.js   ← CORAZÓN del sistema
                     · carga/crea la conversación (estado + context JSON)
                     · si paused → responde PAUSED y corta
                     · parseMessage()  → intent  (src/bot/parser.js)
                     · si HELP → pausa + handoff
                     · si UNKNOWN → cuenta; a las 3 pausa; si no, askClaude()
                     · switch(state) → transición + getResponse()
                     · persiste estado/context
           · envuelve la respuesta en TwiML XML y la devuelve a Twilio
  → Twilio entrega el texto al cliente
```

Mensajes salientes **fuera del webhook** (notificaciones, reanudar) se mandan con
`src/utils/twilioSender.js` (`sendMessage`) — p. ej. al cambiar status de un pedido o al
reanudar una conversación desde el panel.

## Máquina de estados (src/bot/states.js)

`GREETING → MENU → ORDERING → CONFIRM → [AWAITING_PAYMENT → PAYMENT_SENT] → DONE`
más `PAUSED` (handoff). La lógica de transición vive **completa** en `engine.js` (un `switch`).

- Si el tenant tiene datos bancarios (`config.bankName` + `config.accountNumber`), tras
  `CONFIRM` pasa a `AWAITING_PAYMENT` y muestra los datos de transferencia; si no, va directo a `DONE`.
- El umbral de handoff por incomprensión es `UNKNOWN_HANDOFF_THRESHOLD = 3` (en `engine.js`).
- El `context` de la conversación es un JSON con `currentOrder`, `lastMenuItems`, `unknownCount`.

## Estructura del proyecto

```
bot-comida/
├── server.js                  Entry point Express. CORS, routers, /health, /menu,
│                              carga el menú del tenant demo al arrancar.
│
├── src/
│   ├── bot/                   ── MOTOR DE CONVERSACIÓN ──
│   │   ├── engine.js          Máquina de estados + orquestación. processMessage().
│   │   │                      Aquí se decide pausar, llamar a Claude, transicionar.
│   │   ├── parser.js          Texto → intent. normalize() (saca acentos/case) +
│   │   │                      KEYWORDS + regex. Detecta nº de ítem, "2 empanadas",
│   │   │                      quitar ítems, confirmar/cancelar, ayuda. Sin LLM.
│   │   ├── states.js          Enum STATES (8 estados).
│   │   ├── responses.js       Plantillas de texto por estado (getResponse). Formatea
│   │   │                      menú agrupado por categoría y resúmenes de pedido.
│   │   ├── claudeFallback.js  askClaude(): fallback con claude-haiku-4-5. Mete el menú
│   │   │                      + carrito en el system prompt. Reglas anti-alucinación.
│   │   └── test-conversation.js  script manual de prueba del flujo.
│   │
│   ├── db/                    ── PERSISTENCIA (SQLite, better-sqlite3) ──
│   │   ├── database.js        Abre bot.db, PRAGMAs (WAL), CREATE TABLE IF NOT EXISTS de
│   │   │                      las 4 tablas, seed del tenant demo. DB_PATH ← env var.
│   │   ├── queries.js         TODAS las queries (prepared statements). Única capa que
│   │   │                      toca SQL — si migrás a Postgres, es el archivo a reescribir.
│   │   └── test-db.js         script manual de prueba de DB.
│   │
│   ├── routes/                ── HTTP ──
│   │   ├── webhook.js         POST /webhook (Twilio). Parsea, llama al motor, responde TwiML.
│   │   └── admin.js           adminRouter (/admin/*) + apiRouter (/api/*). Auth Bearer token.
│   │                          Endpoints del panel: pedidos, pausadas, resume/pause, config,
│   │                          cambiar status de pedido (notifica al cliente por WhatsApp).
│   │
│   └── utils/
│       ├── menuLoader.js      Lee menu.xlsx (SheetJS) → recarga tabla menu_cache.
│       │                      getMenuFromCache() devuelve solo available=1.
│       ├── twilioSender.js    sendMessage(to,text): saliente fuera del webhook.
│       ├── logger.js          logApiCall() → logs/api-calls.log (tokens de Claude).
│       └── handoffLogger.js   logHandoff() → logs/handoff.log (motivos de pausa).
│
├── public/index.html          Panel servido por el bot (dev / single-server).
├── panel/                     Panel para deploy en Vercel (cross-origin).
│   ├── index.html             ⚠ ADMIN_TOKEN hardcodeado en el front (ver Trampas).
│   └── vercel.json            Rewrites /api/* → bot en Railway (evita CORS).
│
├── menu.xlsx                  Menú editable por el dueño. Columnas: nombre|precio|categoria|disponible
├── bot.db                     SQLite (gitignored, se crea al primer run).
├── logs/                      api-calls.log + handoff.log (gitignored salvo .gitkeep).
├── railway.json               Config de deploy Railway.
├── Procfile                   Fallback estilo Heroku.
└── .env.example               Plantilla de variables de entorno.
```

## Esquema de la base de datos (src/db/database.js)

- **tenants** — `id, name, whatsapp_number (UNIQUE), config (JSON: datos bancarios), active, created_at`
- **orders** — `id, tenant_id, phone, items (JSON), total, status (pending|confirmed|ready|cancelled), created_at`
- **conversations** — `id, tenant_id, phone, state, context (JSON), paused, updated_at`. UNIQUE(tenant_id, phone).
- **menu_cache** — `id, tenant_id, name, price, category, available, loaded_at`. Se borra y recarga entera desde el Excel.

Campos JSON (`config`, `items`, `context`) se guardan como TEXT y se parsean en `queries.js`.

## Variables de entorno (.env)

`PORT` · `ANTHROPIC_API_KEY` · `ADMIN_TOKEN` · `TWILIO_ACCOUNT_SID` · `TWILIO_AUTH_TOKEN` ·
`TWILIO_WHATSAPP_NUMBER`. Además, código usa `DB_PATH` (ruta de SQLite en prod, p. ej.
`/data/bot.db` en el volume de Railway) y `DEMO_TENANT_NUMBER` (default `+56900000000`).
Ver `.env.example` para detalle de cada una.

## Convenciones

- CommonJS (`require`/`module.exports`), no ESM. `"type": "commonjs"`.
- Idioma de cara al cliente: **español chileno**, tono breve (es WhatsApp). Sin emojis en el fallback de Claude.
- Toda query SQL pasa por `src/db/queries.js`. No metas SQL suelto en routes/engine.
- Los números de teléfono se guardan **sin** el prefijo `whatsapp:` (el webhook lo limpia; `twilioSender` lo re-agrega al enviar).

## Trampas conocidas (LEER antes de tocar)

- **El panel hardcodea el tenant demo** (`DEMO_TENANT_NUMBER`). El admin/api siempre opera
  sobre ese único tenant aunque la DB sea multi-tenant. UI multi-tenant requiere login por tenant.
- **ADMIN_TOKEN está en el front del panel** (`panel/index.html`) — cualquiera con DevTools lo ve.
  No es seguro para producción real; mover a sesión/cookie.
- **No se valida la firma de Twilio** (`X-Twilio-Signature`). Cualquiera que descubra la URL del
  webhook puede mandar requests falsas. Falta `twilio.validateRequest()` como middleware.
- **El webhook ignora media** (stickers/imágenes): responde un texto fijo, no procesa.
- **Recargar el menú requiere reiniciar el bot** — `loadMenu()` corre solo al arrancar (`server.js`).
- **SQLite single-instance**: no escalar Railway a 2+ réplicas o habrá `SQLITE_BUSY`/corrupción.
  Para escalar, migrar a Postgres (la lógica ya está aislada en `src/db/`).
- **`xlsx` (SheetJS) tiene CVEs sin fix en npm.** Riesgo bajo mientras el Excel lo controle el
  dueño (no clientes). Migrar a `exceljs` si se agrega "subir menú desde el panel".
- **Sin DB_PATH apuntando a un volume, Railway borra `bot.db` en cada redeploy.**
- **El parser es por keywords/regex, sin LLM.** Cambios en `KEYWORDS`/`REMOVE_PATTERNS` afectan
  directamente qué entiende el bot antes de recurrir a Claude.

## Próximos pasos sugeridos (del README)

Volume persistente + DB_PATH · verificación de firma de Twilio · notificaciones al dueño ·
editar menú desde el panel · login real en el panel · migración a Postgres · tests automatizados.
