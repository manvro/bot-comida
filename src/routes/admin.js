const express = require('express');
const db = require('../db/database');
const {
  getTenantByNumber,
  getPausedConversations,
  resumeConversation,
  pauseConversation,
  updateConversationState,
  getOrdersByDate,
  updateOrderStatus,
} = require('../db/queries');
const { logHandoff } = require('../utils/handoffLogger');

const DEMO_TENANT_NUMBER = process.env.DEMO_TENANT_NUMBER || '+56900000000';
const VALID_STATUSES = ['pending', 'confirmed', 'cancelled'];

function requireAdmin(req, res, next) {
  const expected = process.env.ADMIN_TOKEN;
  const auth = req.headers.authorization || '';
  if (!expected || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  const token = auth.slice('Bearer '.length).trim();
  if (token !== expected) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  next();
}

function getDemoTenantOr404(res) {
  const tenant = getTenantByNumber(DEMO_TENANT_NUMBER);
  if (!tenant) {
    res.status(404).json({ error: 'Tenant demo no encontrado' });
    return null;
  }
  return tenant;
}

const adminRouter = express.Router();
adminRouter.use(requireAdmin);

adminRouter.get('/paused', (req, res) => {
  const tenant = getDemoTenantOr404(res);
  if (!tenant) return;
  const rows = getPausedConversations(tenant.id);
  const data = rows.map((r) => ({
    phone: r.phone,
    state: r.state,
    context: r.context,
    updated_at: r.updated_at,
  }));
  res.json(data);
});

adminRouter.post('/resume', (req, res) => {
  const { phone } = req.body || {};
  if (!phone) return res.status(400).json({ error: 'phone requerido' });
  const tenant = getDemoTenantOr404(res);
  if (!tenant) return;

  resumeConversation(tenant.id, phone);

  const conv = db
    .prepare('SELECT state, context FROM conversations WHERE tenant_id = ? AND phone = ?')
    .get(tenant.id, phone);
  if (conv) {
    const ctx = JSON.parse(conv.context || '{}');
    ctx.unknownCount = 0;
    updateConversationState(tenant.id, phone, conv.state, ctx);
  }

  res.json({ ok: true, phone });
});

adminRouter.post('/pause', (req, res) => {
  const { phone } = req.body || {};
  if (!phone) return res.status(400).json({ error: 'phone requerido' });
  const tenant = getDemoTenantOr404(res);
  if (!tenant) return;

  pauseConversation(tenant.id, phone);
  logHandoff(tenant.id, phone, 'pausa_manual');

  res.json({ ok: true, phone });
});

const apiRouter = express.Router();
apiRouter.use(requireAdmin);

apiRouter.get('/orders', (req, res) => {
  const tenant = getDemoTenantOr404(res);
  if (!tenant) return;
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const orders = getOrdersByDate(tenant.id, date);
  res.json(orders);
});

apiRouter.put('/orders/:id/status', (req, res) => {
  const tenant = getDemoTenantOr404(res);
  if (!tenant) return;

  const orderId = parseInt(req.params.id, 10);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return res.status(400).json({ error: 'id inválido' });
  }

  const { status } = req.body || {};
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({
      error: `status inválido. Debe ser uno de: ${VALID_STATUSES.join(', ')}`,
    });
  }

  const changes = updateOrderStatus(tenant.id, orderId, status);
  if (changes === 0) {
    return res.status(404).json({ error: 'pedido no encontrado' });
  }
  res.json({ ok: true });
});

module.exports = { adminRouter, apiRouter };
