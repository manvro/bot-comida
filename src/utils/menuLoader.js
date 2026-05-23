const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const db = require('../db/database');

const MENU_PATH = path.join(__dirname, '..', '..', 'menu.xlsx');

function normalizeAvailable(value) {
  if (value === true) return true;
  if (value === false) return false;
  if (typeof value === 'number') return value === 1;
  const v = String(value ?? '').trim().toLowerCase();
  return v === 'si' || v === 'sí' || v === 's' || v === '1' || v === 'true';
}

function loadMenu(tenant_id) {
  if (!fs.existsSync(MENU_PATH)) {
    throw new Error(`No se encontró el archivo de menú en: ${MENU_PATH}`);
  }

  const workbook = XLSX.readFile(MENU_PATH);
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  const items = rows
    .map(r => ({
      name: String(r.nombre ?? '').trim(),
      price: Number(r.precio),
      category: String(r.categoria ?? '').trim(),
      available: normalizeAvailable(r.disponible),
    }))
    .filter(i => i.name && !Number.isNaN(i.price));

  const deleteStmt = db.prepare('DELETE FROM menu_cache WHERE tenant_id = ?');
  const insertStmt = db.prepare(`
    INSERT INTO menu_cache (tenant_id, name, price, category, available)
    VALUES (?, ?, ?, ?, ?)
  `);

  const reload = db.transaction((tenantId, list) => {
    deleteStmt.run(tenantId);
    for (const it of list) {
      insertStmt.run(tenantId, it.name, it.price, it.category, it.available ? 1 : 0);
    }
  });

  reload(tenant_id, items);
  return items.length;
}

function getMenuFromCache(tenant_id) {
  const rows = db.prepare(`
    SELECT name, price, category
    FROM menu_cache
    WHERE tenant_id = ? AND available = 1
    ORDER BY category ASC, name ASC
  `).all(tenant_id);

  return rows;
}

module.exports = { loadMenu, getMenuFromCache };
