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
node src/db/create-user.js <email> <pass> [tenant_id=1]   # alta de usuario del panel
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

### Autenticación del panel (login real)

El panel usa **login con usuario/contraseña + JWT** (ya no el viejo `ADMIN_TOKEN`):

```
Panel → POST /auth/login {email, password}   (src/routes/auth.js)
   · rate-limit: 5 intentos / 15 min por email (en memoria); compare anti-timing
   · bcrypt.compare contra users.password_hash
   · signToken({userId, tenantId, email}) → JWT (expira 8h)   (src/middleware/auth.js)
Panel guarda el token y lo manda como `Authorization: Bearer <jwt>` en cada request.
/admin/* y /api/* → requireAuth verifica el JWT y setea req.user.
   · cada endpoint opera sobre req.user.tenantId → cada usuario ve SOLO su tenant.
```

Alta de usuarios: `node src/db/create-user.js <email> <pass> [tenant_id]` (hashea con bcrypt).

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
│   │   ├── create-user.js     CLI para crear usuarios del panel (bcrypt).
│   │   └── test-db.js         script manual de prueba de DB.
│   │
│   ├── routes/                ── HTTP ──
│   │   ├── webhook.js         POST /webhook (Twilio). Parsea, llama al motor, responde TwiML.
│   │   ├── admin.js           adminRouter (/admin/*) + apiRouter (/api/*). Protegidos por
│   │   │                      requireAuth (JWT), scopeados por req.user.tenantId. Endpoints
│   │   │                      del panel: pedidos, pausadas, resume/pause, config, cambiar
│   │   │                      status de pedido (notifica al cliente por WhatsApp).
│   │   └── auth.js            POST /auth/login. bcrypt + rate-limit, emite JWT.
│   │
│   ├── middleware/
│   │   └── auth.js            signToken() + requireAuth(). JWT (jsonwebtoken), expira 8h.
│   │                          Lee JWT_SECRET de env (fallback inseguro si falta).
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
- **users** — `id, tenant_id, email (UNIQUE), password_hash (bcrypt), created_at`. Login del panel.

Campos JSON (`config`, `items`, `context`) se guardan como TEXT y se parsean en `queries.js`.

## Variables de entorno (.env)

`PORT` · `ANTHROPIC_API_KEY` · `JWT_SECRET` (firma de los JWT del panel — **obligatorio en
prod**, fallback inseguro si falta) · `TWILIO_ACCOUNT_SID` · `TWILIO_AUTH_TOKEN` ·
`TWILIO_WHATSAPP_NUMBER`. `ADMIN_TOKEN` quedó legacy (reemplazado por el login con JWT).
Además, código usa `DB_PATH` (ruta de SQLite en prod, p. ej. `/data/bot.db` en el volume de
Railway) y `DEMO_TENANT_NUMBER` (default `+56900000000`). Ver `.env.example` para detalle.

## Convenciones

- CommonJS (`require`/`module.exports`), no ESM. `"type": "commonjs"`.
- Idioma de cara al cliente: **español chileno**, tono breve (es WhatsApp). Sin emojis en el fallback de Claude.
- Toda query SQL pasa por `src/db/queries.js`. No metas SQL suelto en routes/engine.
- Los números de teléfono se guardan **sin** el prefijo `whatsapp:` (el webhook lo limpia; `twilioSender` lo re-agrega al enviar).

## Trampas conocidas (LEER antes de tocar)

- **`JWT_SECRET` tiene un fallback inseguro** (`dev-secret-change-in-prod` en `middleware/auth.js`).
  Si no se setea la env var en prod, cualquiera puede forjar tokens válidos. Setearla SIEMPRE en Railway.
- **El rate-limit del login es en memoria** (`Map` en `auth.js`) — se pierde al reiniciar y no
  sirve con múltiples réplicas. OK para single-instance; migrar a store compartido si se escala.
- **El admin/api ya es multi-tenant por token** (`req.user.tenantId`), pero el front del panel
  todavía puede asumir un solo tenant. Verificar el flujo de login→tenant al sumar varios restaurantes.
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
editar menú desde el panel · migración a Postgres · tests automatizados.
(✓ login real en el panel — hecho: JWT + tabla users.)
