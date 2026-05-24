require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const { getTenantByNumber } = require('./src/db/queries');
const { loadMenu, getMenuFromCache } = require('./src/utils/menuLoader');
const { adminRouter, apiRouter } = require('./src/routes/admin');
const webhookRouter = require('./src/routes/webhook');

const DEMO_TENANT_NUMBER = process.env.DEMO_TENANT_NUMBER || '+56900000000';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: ['https://bot-comida.vercel.app', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'PUT'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use(express.static(path.join(__dirname, 'public')));

app.use('/admin', adminRouter);
app.use('/api', apiRouter);
app.use('/webhook', webhookRouter);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Bot de comida activo' });
});

app.get('/menu', (req, res) => {
  const tenant = getTenantByNumber(DEMO_TENANT_NUMBER);
  if (!tenant) {
    return res.status(404).json({ error: 'Tenant demo no encontrado' });
  }
  const items = getMenuFromCache(tenant.id);
  res.json({ tenant: tenant.name, items, total: items.length });
});

try {
  const tenant = getTenantByNumber(DEMO_TENANT_NUMBER);
  if (tenant) {
    const count = loadMenu(tenant.id);
    console.log(`Menú cargado: ${count} ítems para ${tenant.name}`);
  } else {
    console.warn(`No se encontró tenant demo con número ${DEMO_TENANT_NUMBER}`);
  }
} catch (err) {
  console.error('Error al cargar menú al arrancar:', err.message);
}

app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
