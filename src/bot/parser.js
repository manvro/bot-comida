function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

const KEYWORDS = {
  HELP:    ['ayuda', 'humano', 'persona', 'problema', 'ayudame'],
  CANCEL:  ['cancelar', 'salir', 'cancelo'],
  CONFIRM: ['confirmar', 'confirmo', 'ok', 'dale', 'listo', 'perfecto'],
  START:   ['hola', 'buenas', 'menu', 'pedir', 'pedido', 'hacer'],
  PAYMENT_SENT: ['transferi', 'ya pague', 'hice la transferencia', 'pague'],
};

const REMOVE_PATTERNS = [
  /^ya no quiero (.+)$/,
  /^(?:quita|quitame|saca|sacame|elimina|eliminame|quitar|sacar|eliminar)\s+(.+)$/,
  /^sin (.+)$/,
];

function hasKeyword(text, keywords) {
  return keywords.some(k => new RegExp(`\\b${k}\\b`).test(text));
}

function matchRemove(normalized) {
  for (const re of REMOVE_PATTERNS) {
    const m = normalized.match(re);
    if (m && m[1].trim()) return m[1].trim();
  }
  return null;
}

function matchItem(text, lastMenuItems) {
  if (!lastMenuItems || lastMenuItems.length === 0) return null;
  const messageWords = text.split(/[\s\W]+/).filter(Boolean);

  for (const item of lastMenuItems) {
    const itemNorm = normalize(item.name);
    const itemWords = itemNorm.split(/[\s\W]+/).filter(w => w.length >= 4);
    if (itemWords.some(w => messageWords.includes(w))) {
      return item.name;
    }
  }
  return null;
}

function parseMessage(text, context = {}) {
  const normalized = normalize(text);
  if (!normalized) return { intent: 'UNKNOWN' };

  const numMatch = normalized.match(/^(\d+)$/);
  if (numMatch) {
    return { intent: 'SELECT_ITEM', index: parseInt(numMatch[1], 10) };
  }

  if (hasKeyword(normalized, KEYWORDS.HELP)) return { intent: 'HELP' };
  if (hasKeyword(normalized, KEYWORDS.CANCEL) || normalized === 'no') return { intent: 'CANCEL' };

  const removeName = matchRemove(normalized);
  if (removeName) return { intent: 'REMOVE_ITEM', name: removeName };

  if (hasKeyword(normalized, KEYWORDS.PAYMENT_SENT)) return { intent: 'PAYMENT_SENT' };
  if (hasKeyword(normalized, KEYWORDS.CONFIRM) || normalized === 'si') return { intent: 'CONFIRM' };
  if (hasKeyword(normalized, KEYWORDS.START)) return { intent: 'START' };

  const itemName = matchItem(normalized, context.lastMenuItems);
  if (itemName) return { intent: 'SELECT_ITEM', name: itemName };

  return { intent: 'UNKNOWN' };
}

module.exports = { parseMessage, normalize };
