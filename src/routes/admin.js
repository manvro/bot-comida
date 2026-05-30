const express = require('express');
const db = require('../db/database');
const {
  updateTenantConfig,
  getPausedConversations,
  resumeConversation,
  pauseConversation,
  updateConversationState,
  getOrdersByDate,
  getOrderById,
  updateOrderStatus,
  getTenantById,
} = require('../db/queries');
const { sendMessage } = require('../utils/twilioSender');
const { logHandoff } = require('../utils/handoffLogger');
const { requireAuth } = require('../middleware/auth');

const VALID_STATUSES = ['pending', 'confirmed', 'ready', 'cancelled'];

const STATUS_NOTIFICATIONS = {
  confirmed: '✓ Pago confirmado. Tu pedido está siendo preparado.',
  ready: '✓ Tu pedido está listo. Puedes retirarlo.',
  cancelled: 'Tu pedido fue cancelado. Escribe *hola* para hacer uno nuevo.',
};

const STATUSES_RESET_CONVERSATION = ['confirmed', 'ready', 'cancelled'];

function getTenantOr404(res, tenantId) {
  const tenant = getTenantById(tenantId);
  if (!tenant) {
    res.status(404).json({ error: 'Tenant no encontrado' });
    return null;
  }
  return tenant;
}

const adminRouter = express.Router();
adminRouter.use(requireAuth);

adminRouter.get('/paused', (req, res) => {
  const tenant = getTenantOr404(res, req.user.tenantId);
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
  const tenant = getTenantOr404(res, req.user.tenantId);
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

  sendMessage(phone, 'Hola, ya estoy aquí para ayudarte. ¿En qué te puedo asistir?').catch(err => console.error('[resume] Error enviando mensaje:', err));
  res.json({ ok: true, phone });
});

adminRouter.post('/pause', (req, res) => {
  const { phone } = req.body || {};
  if (!phone) return res.status(400).json({ error: 'phone requerido' });
  const tenant = getTenantOr404(res, req.user.tenantId);
  if (!tenant) return;

  pauseConversation(tenant.id, phone);
  logHandoff(tenant.id, phone, 'pausa_manual');

  res.json({ ok: true, phone });
});

adminRouter.get('/config', (req, res) => {
  const tenant = getTenantOr404(res, req.user.tenantId);
  if (!tenant) return;
  res.json(tenant.config || {});
});

adminRouter.put('/config', (req, res) => {
  const tenant = getTenantOr404(res, req.user.tenantId);
  if (!tenant) return;
  const { bankName, accountNumber, accountHolder, rut, bankType } = req.body || {};
  const newConfig = {
    ...tenant.config,
    bankName:      bankName != null ? String(bankName).trim() : '',
    accountNumber: accountNumber != null ? String(accountNumber).trim() : '',
    accountHolder: accountHolder != null ? String(accountHolder).trim() : '',
    rut:           rut != null ? String(rut).trim() : '',
    bankType:      bankType != null ? String(bankType).trim() : '',
  };
  updateTenantConfig(tenant.id, newConfig);
  res.json({ ok: true, config: newConfig });
});

const apiRouter = express.Router();
apiRouter.use(requireAuth);

apiRouter.get('/orders', (req, res) => {
  const tenant = getTenantOr404(res, req.user.tenantId);
  if (!tenant) return;
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const orders = getOrdersByDate(tenant.id, date);
  res.json(orders);
});

apiRouter.put('/orders/:id/status', (req, res) => {
  const tenant = getTenantOr404(res, req.user.tenantId);
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

  const order = getOrderById(tenant.id, orderId);
  if (!order) {
    return res.status(404).json({ error: 'pedido no encontrado' });
  }

  updateOrderStatus(tenant.id, orderId, status);

  if (STATUSES_RESET_CONVERSATION.includes(status) && order.phone) {
    updateConversationState(tenant.id, order.phone, 'GREETING', {
      currentOrder: [],
      lastMenuItems: [],
      unknownCount: 0,
    });
  }

  const msg = STATUS_NOTIFICATIONS[status];
  if (msg && order.phone) {
    sendMessage(order.phone, msg).catch(err =>
      console.error('[orders/status] Error notificando al cliente:', err)
    );
  }

  res.json({ ok: true });
});

module.exports = { adminRouter, apiRouter };