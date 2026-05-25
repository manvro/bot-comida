const db = require('./database');

function getTenantByNumber(whatsapp_number) {
  const row = db.prepare(`
    SELECT id, name, whatsapp_number, config, active, created_at
    FROM tenants
    WHERE whatsapp_number = ?
  `).get(whatsapp_number);

  if (!row) return null;
  return { ...row, config: JSON.parse(row.config || '{}') };
}

function getTenantById(tenant_id) {
  const row = db.prepare(`
    SELECT id, name, whatsapp_number, config, active, created_at
    FROM tenants
    WHERE id = ?
  `).get(tenant_id);

  if (!row) return null;
  return { ...row, config: JSON.parse(row.config || '{}') };
}

function updateTenantConfig(tenant_id, config) {
  db.prepare(`UPDATE tenants SET config = ? WHERE id = ?`)
    .run(JSON.stringify(config || {}), tenant_id);
}

function getOrderById(tenant_id, order_id) {
  const row = db.prepare(`
    SELECT id, tenant_id, phone, items, total, status, created_at
    FROM orders WHERE id = ? AND tenant_id = ?
  `).get(order_id, tenant_id);
  if (!row) return null;
  return { ...row, items: JSON.parse(row.items) };
}

function saveOrder(tenant_id, phone, items, total) {
  const result = db.prepare(`
    INSERT INTO orders (tenant_id, phone, items, total)
    VALUES (?, ?, ?, ?)
  `).run(tenant_id, phone, JSON.stringify(items), total);
  return result.lastInsertRowid;
}

function getOrdersByDate(tenant_id, date) {
  const rows = db.prepare(`
    SELECT id, tenant_id, phone, items, total, status, created_at
    FROM orders
    WHERE tenant_id = ?
      AND date(created_at) = date(?)
    ORDER BY created_at ASC
  `).all(tenant_id, date);

  return rows.map(r => ({ ...r, items: JSON.parse(r.items) }));
}

function getOrCreateConversation(tenant_id, phone) {
  const existing = db.prepare(`
    SELECT id, tenant_id, phone, state, context, paused, updated_at
    FROM conversations
    WHERE tenant_id = ? AND phone = ?
  `).get(tenant_id, phone);

  if (existing) {
    return { ...existing, context: JSON.parse(existing.context || '{}') };
  }

  const result = db.prepare(`
    INSERT INTO conversations (tenant_id, phone, state, context)
    VALUES (?, ?, NULL, '{}')
  `).run(tenant_id, phone);

  return db.prepare(`
    SELECT id, tenant_id, phone, state, context, paused, updated_at
    FROM conversations
    WHERE id = ?
  `).get(result.lastInsertRowid);
}

function updateConversationState(tenant_id, phone, state, context) {
  db.prepare(`
    UPDATE conversations
    SET state = ?, context = ?, updated_at = datetime('now')
    WHERE tenant_id = ? AND phone = ?
  `).run(state, JSON.stringify(context || {}), tenant_id, phone);
}

function pauseConversation(tenant_id, phone) {
  db.prepare(`
    UPDATE conversations
    SET paused = 1, updated_at = datetime('now')
    WHERE tenant_id = ? AND phone = ?
  `).run(tenant_id, phone);
}

function resumeConversation(tenant_id, phone) {
  db.prepare(`
    UPDATE conversations
    SET paused = 0, updated_at = datetime('now')
    WHERE tenant_id = ? AND phone = ?
  `).run(tenant_id, phone);
}

function updateOrderStatus(tenant_id, order_id, status) {
  const result = db.prepare(`
    UPDATE orders
    SET status = ?
    WHERE id = ? AND tenant_id = ?
  `).run(status, order_id, tenant_id);
  return result.changes;
}

function getPausedConversations(tenant_id) {
  const rows = db.prepare(`
    SELECT id, tenant_id, phone, state, context, paused, updated_at
    FROM conversations
    WHERE tenant_id = ? AND paused = 1
    ORDER BY updated_at DESC
  `).all(tenant_id);

  return rows.map(r => ({ ...r, context: JSON.parse(r.context || '{}') }));
}

module.exports = {
  getTenantByNumber,
  getTenantById,
  updateTenantConfig,
  saveOrder,
  getOrdersByDate,
  getOrderById,
  updateOrderStatus,
  getOrCreateConversation,
  updateConversationState,
  pauseConversation,
  resumeConversation,
  getPausedConversations,
};
