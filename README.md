# Bot Comida — WhatsApp para restaurantes

Bot de pedidos por WhatsApp para restaurantes pequeños. El dueño actualiza un `menu.xlsx` cada día y el bot atiende a los clientes en automático: les muestra el menú, toma sus pedidos, los confirma y los guarda en una base de datos local. Cuando el bot no entiende un mensaje recurre a **Claude (Haiku 4.5)** como fallback con el menú completo en el system prompt — así responde preguntas razonables sin inventar precios ni ítems que no existan.

Si la conversación se traba (el cliente pide "humano" o el bot no entiende tres mensajes seguidos), la conversación se **pausa automáticamente** y queda esperando que el dueño la retome desde un **panel web**. El panel muestra los pedidos del día, las conversaciones pausadas y el menú activo, con polling cada 20 segundos. El bot corre en Railway, el panel se despliega en Vercel.

---

## Requisitos previos

- **Node.js >= 20** (LTS recomendado).
- **Git** y una cuenta de **GitHub**.
- **Cuenta de Anthropic** con créditos para la API ([console.anthropic.com](https://console.anthropic.com)).
- **Cuenta de Twilio** con el sandbox de WhatsApp activado ([twilio.com](https://www.twilio.com/)).
- **Cuenta de Railway** ([railway.app](https://railway.app)) para hostear el bot.
- **Cuenta de Vercel** ([vercel.com](https://vercel.com)) para hostear el panel.
- Opcional: **ngrok** para exponer localhost durante el desarrollo.

---

## Setup local

```bash
git clone <URL-DE-TU-REPO>
cd bot-comida
npm install
cp .env.example .env
# Editá .env con tus credenciales reales
```

Necesitás también un `menu.xlsx` en la raíz (el repo no incluye uno por default; en este proyecto se generó uno demo durante el desarrollo). Si no lo tenés, podés crear uno con las columnas exactas: `nombre | precio | categoria | disponible`.

Para arrancar en modo desarrollo:

```bash
npm run dev
```

Y en otra terminal, para exponer el webhook a Twilio:

```bash
ngrok http 3000
```

Tomá la URL `https://...ngrok-free.app` que te da, y configurala en el panel de Twilio: **Messaging → Try it out → Send a WhatsApp message → Sandbox settings → "When a message comes in"**, pegándole `/webhook` al final. Más detalles abajo en *Deploy*.

Para abrir el panel localmente: `http://localhost:3000/`.

---

## Variables de entorno

| Variable                  | Para qué sirve                                                       | Dónde obtenerla                                                                 |
| ------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `PORT`                    | Puerto del servidor Express                                          | Local: `3000`. Railway: lo asigna la plataforma (no fijar).                     |
| `ANTHROPIC_API_KEY`       | Llamadas al modelo `claude-haiku-4-5` como fallback                  | [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) |
| `ADMIN_TOKEN`             | Auth de los endpoints `/admin/*` y `/api/*`                          | Generalo vos mismo. En prod: cadena aleatoria >= 32 chars.                      |
| `TWILIO_ACCOUNT_SID`      | Identificador de tu cuenta Twilio                                    | [console.twilio.com](https://console.twilio.com) → Account Info                  |
| `TWILIO_AUTH_TOKEN`       | Token secreto de tu cuenta Twilio                                    | Mismo lugar, debajo del SID                                                     |
| `TWILIO_WHATSAPP_NUMBER`  | Número de WhatsApp desde el que el bot envía mensajes                | Sandbox compartido: `+14155238886`. Prod: tu número WhatsApp Business aprobado. |

---

## Deploy en Railway (bot)

1. **Push del repo a GitHub.** Asegurate que tu `.env` no esté trackeado (el `.gitignore` ya lo ignora).
2. Entrá a [railway.app/new](https://railway.app/new) y elegí **"Deploy from GitHub repo"**. Conectá tu cuenta y seleccioná este repo.
3. Railway detecta `railway.json` y `package.json`, y arranca el primer build con Nixpacks. Va a tirar la primera build sin variables → el server no levantará.
4. En el dashboard del servicio, andá a **Variables** y cargá las que están en `.env.example` (todas menos `PORT`, que Railway asigna sola). Para `TWILIO_WHATSAPP_NUMBER`, usá el número que tengas aprobado o el del sandbox.
5. **Agregá un Volume persistente** (este paso es clave — sin él, perdés la base de datos en cada redeploy):
   - En el servicio → **Settings → Volumes → Add Volume**
   - Mount Path: `/data` (o el que prefieras)
   - Tamaño: 1 GB es más que suficiente para empezar
   - Si no apuntás el `bot.db` al volume, Railway lo va a destruir cada reinicio. Para apuntarlo:
     - Edita `src/db/database.js` para que `DB_PATH` lea de una env var:
       ```js
       const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'bot.db');
       ```
     - En Railway → Variables, agregá `DB_PATH=/data/bot.db`.
6. **Generá un dominio público:** Settings → Networking → **Generate Domain**. Te da una URL `https://xxxx.up.railway.app`. Guardala.
7. **Configurá el webhook en Twilio:**
   - Console → Messaging → Try it out → Send a WhatsApp message → Sandbox settings.
   - En "When a message comes in" pegá `https://xxxx.up.railway.app/webhook`. Método: POST. Save.
8. **Apuntá el tenant al número de Twilio** que estás usando. Una vez (si todavía no lo hiciste):
   ```bash
   # Local, contra un dump de la DB en Railway, o vía Railway CLI:
   railway run node -e "require('./src/db/database').prepare('UPDATE tenants SET whatsapp_number=? WHERE id=1').run('+14155238886')"
   ```
   Si usás sandbox compartido, el número es `+14155238886`. Si tenés número productivo aprobado, ponelo ahí.
9. **Probá** mandando un WhatsApp al número del bot. Los logs en Railway → Deployments → View Logs deberían mostrar `[webhook] +... -> +... : "hola"`.

### Healthcheck

Railway puede chequear que el bot está vivo. Configurá:
- **Settings → Healthcheck Path:** `/health`
- Espera respuesta 200 con `{"status":"ok",...}`.

---

## Deploy del panel en Vercel

El panel es HTML estático que llama a la API del bot. Lo recomendado es usar **rewrites de Vercel** para que el panel pegue a paths relativos (`/api/*`) y Vercel los proxee al bot en Railway — así evitamos configurar CORS.

1. **Editá `panel/vercel.json`** y reemplazá `REEMPLAZAR-URL-DEL-BOT.up.railway.app` por la URL real del bot en Railway (sin `https://` final ni slashes — el archivo ya las trae).
2. **Editá `panel/index.html`** y dejá `window.API_BASE_URL = ''` (string vacío) — pegá esta línea en un `<script>` antes del JS principal:
   ```html
   <script>window.API_BASE_URL = '';</script>
   ```
   Eso hace que los fetch del panel salgan a paths relativos, que Vercel reescribe.
3. **Push los cambios** a GitHub.
4. Entrá a [vercel.com/new](https://vercel.com/new), importá el repo desde GitHub, y en la configuración del proyecto poné:
   - **Root Directory:** `panel`
   - Framework Preset: **Other** (es HTML estático puro)
   - Build Command: dejá vacío
   - Output Directory: dejá vacío
5. **Deploy.** Vercel te da un dominio `https://tu-panel.vercel.app`.
6. **Cambiá `ADMIN_TOKEN`** en `panel/index.html` al valor real que pusiste en Railway antes de hacer push final (recordá que el token está hardcoded en el front de esta etapa — cualquiera con DevTools lo ve; mejorá esto antes de pasar a producción seria).
7. **Verificá** abriendo `https://tu-panel.vercel.app/`. Deberías ver pedidos del día y conversaciones pausadas.

### Alternativa: sin rewrites (con CORS)

Si preferís que el panel haga fetch directo a Railway en vez de pasar por rewrites:

1. Borrá `panel/vercel.json` o vaciá los rewrites.
2. En `panel/index.html`, definí `window.API_BASE_URL = 'https://tu-bot.up.railway.app'` (URL completa, sin slash final).
3. Sumá CORS al bot:
   ```bash
   npm install cors
   ```
   En `server.js`, antes de los routers:
   ```js
   const cors = require('cors');
   app.use(cors({ origin: 'https://tu-panel.vercel.app' }));
   ```
4. Redeploy en Railway.

---

## Cómo actualizar el menú (para el dueño, sin saber programar)

El menú está en el archivo `menu.xlsx` (Excel) en la raíz del proyecto. Las columnas son:

| nombre              | precio | categoria          | disponible |
| ------------------- | ------ | ------------------ | ---------- |
| Empanada de carne   | 1500   | Entradas           | si         |
| Milanesa napolitana | 7900   | Platos principales | si         |
| Ravioles de ricota  | 6800   | Platos principales | no         |
| Coca-Cola 500ml     | 1800   | Bebidas            | si         |

- `disponible = si` → aparece en el menú que ve el cliente.
- `disponible = no` → desaparece (útil cuando se acaba un ítem).
- Editá el Excel, guardalo, **reiniciá el bot** (en Railway: Deploy → Restart). El bot recarga el menú al arrancar.

Mejora futura: subir el `menu.xlsx` desde el panel y recargar caliente sin reiniciar.

---

## Cómo agregar un nuevo cliente (tenant)

La arquitectura ya es multi-tenant — la tabla `tenants` lleva varios restaurantes. Hoy se agrega vía SQL directo:

```bash
railway run node -e "require('./src/db/database').prepare(\"INSERT INTO tenants (name, whatsapp_number, active) VALUES (?, ?, 1)\").run('Pizzeria del Barrio', '+5491111112222')"
```

Después necesitás:
- Que ese número (`+5491111112222`) sea uno que Twilio tenga aprobado y apuntado al webhook del bot.
- Cargar un menú propio del tenant en `menu_cache` (todavía no soportamos múltiples archivos `.xlsx` — eso es una mejora pendiente).

Mejora futura: panel multi-tenant donde cada dueño se loguea y ve solo su data.

---

## Limitaciones conocidas

- **SQLite single-instance.** Si Railway escala a 2+ replicas, hay corrupción/`SQLITE_BUSY`. Para escalar, migrar a Postgres (lógica de DB ya está aislada en `src/db/`).
- **Panel solo apunta a un tenant.** El panel hardcodea el tenant demo. Multi-tenant en UI requiere login por tenant.
- **Token de admin hardcoded en el front del panel.** Cualquiera con DevTools lo lee. Para producción real, mover auth a cookies/sesión.
- **No verifica firma de Twilio (`X-Twilio-Signature`).** Cualquiera que descubra la URL del webhook puede enviar requests fake. Sumar `twilio.validateRequest()` como middleware antes del webhook.
- **`xlsx` (SheetJS) tiene CVEs sin fix en npm.** Mientras el archivo lo controle el dueño (no lo suban clientes), riesgo bajo. Migrar a `exceljs` cuando agreguemos "subir menú desde el panel".
- **Sin tests automatizados.** Hay scripts manuales (`test-db.js`, `test-conversation.js`) pero ningún runner. Sumar Jest/Vitest cuando el proyecto crezca.
- **Sin notificación al dueño** cuando una conversación se pausa (handoff). El dueño tiene que mirar el panel. Mejora: usar `twilioSender.sendMessage(...)` para mandarle un WhatsApp al teléfono del dueño.
- **Una sola hoja `menu.xlsx`** para todos los tenants. Cuando haya N restaurantes, cada uno necesita su propio menú.
- **Reload de menú requiere reiniciar el bot.** Idealmente, polling del archivo o trigger desde el panel.

## Próximos pasos sugeridos

1. **Volume persistente en Railway** y `DB_PATH` apuntando ahí (paso obligatorio para producción).
2. **Verificación de firma de Twilio.** Una línea de middleware, mucho menos abuso potencial.
3. **Notificaciones al dueño** vía `twilioSender` cuando una conversación se pausa o llega un pedido grande.
4. **Editar menú desde el panel** (subir Excel o editar tabla inline).
5. **Login real en el panel** (cookie de sesión, no token en el front).
6. **Migración a Postgres** cuando lleguemos a varias decenas de tenants o necesitemos analytics.
7. **Tests automatizados** sobre el motor (parser, engine) y los handlers HTTP.

---

## Estructura del proyecto

```
bot-comida/
├── src/
│   ├── bot/          motor de conversación, parser, estados, fallback Claude
│   ├── db/           SQLite, queries
│   ├── routes/       webhook Twilio, rutas admin + api
│   └── utils/        lector Excel, loggers, twilioSender
├── public/           panel servido por el bot (dev / single-server deploy)
├── panel/            versión del panel para Vercel (cross-origin)
├── logs/             logs de API calls + handoff events
├── menu.xlsx         menú del restaurante (editable por el dueño)
├── bot.db            SQLite (gitignored, gen on first run)
├── server.js         entry point
├── railway.json      config de deploy Railway
├── Procfile          fallback para deploy estilo Heroku
└── .env.example      plantilla de variables de entorno
```

---

## Licencia

Privada. Uso interno para el dueño/cliente que contrate el bot.
