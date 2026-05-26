const { STATES } = require('./states');
const { parseMessage, normalize } = require('./parser');
const { getResponse } = require('./responses');
const {
  getOrCreateConversation,
  updateConversationState,
  pauseConversation,
  saveOrder,
  getTenantById,
} = require('../db/queries');
const { getMenuFromCache } = require('../utils/menuLoader');
const { askClaude } = require('./claudeFallback');
const { logApiCall } = require('../utils/logger');
const { logHandoff } = require('../utils/handoffLogger');

const UNKNOWN_HANDOFF_THRESHOLD = 3;

function addToOrder(currentOrder, item) {
  const existing = currentOrder.find(o => o.name === item.name);
  if (existing) {
    existing.quantity += 1;
  } else {
    currentOrder.push({ name: item.name, price: item.price, quantity: 1 });
  }
}

function removeFromOrder(currentOrder, nameText) {
  const target = normalize(nameText);
  if (!target) return null;
  const targetWords = target.split(/[\s\W]+/).filter(w => w.length >= 4);

  for (let i = 0; i < currentOrder.length; i++) {
    const itemNorm = normalize(currentOrder[i].name);
    if (itemNorm.includes(target) || target.includes(itemNorm)) {
      return currentOrder.splice(i, 1)[0];
    }
    const itemWords = itemNorm.split(/[\s\W]+/).filter(w => w.length >= 4);
    if (targetWords.some(tw => itemWords.includes(tw))) {
      return currentOrder.splice(i, 1)[0];
    }
  }
  return null;
}

function hasBankInfo(config) {
  return !!(config && config.bankName && config.accountNumber);
}

function findItem(lastMenuItems, intent) {
  if (intent.index != null) {
    return lastMenuItems[intent.index - 1] || null;
  }
  if (intent.name) {
    return lastMenuItems.find(i => i.name === intent.name) || null;
  }
  return null;
}

function loadMenuIntoContext(tenant_id, context) {
  const items = getMenuFromCache(tenant_id);
  context.lastMenuItems = items;
  return items;
}

async function processMessage(tenant_id, phone, incomingText) {
  const conv = getOrCreateConversation(tenant_id, phone);

  if (conv.paused) {
    return getResponse(STATES.PAUSED);
  }

  const context =
    typeof conv.context === 'string'
      ? JSON.parse(conv.context || '{}')
      : (conv.context || {});
  context.currentOrder = context.currentOrder || [];
  context.lastMenuItems = context.lastMenuItems || [];
  context.unknownCount = context.unknownCount || 0;

  const state = conv.state || STATES.GREETING;
  const intent = parseMessage(incomingText, context);

  if (intent.intent === 'HELP') {
    pauseConversation(tenant_id, phone);
    logHandoff(tenant_id, phone, 'pidio_ayuda');
    return getResponse(STATES.PAUSED);
  }

  if (intent.intent === 'UNKNOWN') {
    context.unknownCount += 1;
    updateConversationState(tenant_id, phone, state, context);

    if (context.unknownCount >= UNKNOWN_HANDOFF_THRESHOLD) {
      pauseConversation(tenant_id, phone);
      logHandoff(tenant_id, phone, `unknown_count=${context.unknownCount}`);
      return getResponse(STATES.PAUSED);
    }

    const claudeResponse = await askClaude(tenant_id, phone, incomingText, context);
    const totalTokens = claudeResponse.inputTokens + claudeResponse.outputTokens;
    logApiCall(tenant_id, phone, incomingText, totalTokens);
    return claudeResponse.text;
  }

  context.unknownCount = 0;

  let newState = state;
  let response = '';

  switch (state) {
    case STATES.GREETING:
    case STATES.DONE: {
      if (intent.intent === 'START') {
        const items = loadMenuIntoContext(tenant_id, context);
        context.currentOrder = [];
        newState = STATES.MENU;
        response =
          getResponse(STATES.GREETING) + '\n\n' + getResponse(STATES.MENU, { items });
      } else {
        response = 'Cuando quieras pedir, escribí *hola* o *menu*.';
      }
      break;
    }

    case STATES.MENU: {
      if (intent.intent === 'SELECT_ITEM') {
        const item = findItem(context.lastMenuItems, intent);
        if (item) {
          addToOrder(context.currentOrder, item);
          newState = STATES.ORDERING;
          response = getResponse(STATES.ORDERING, {
            lastItem: item,
            order: context.currentOrder,
          });
        } else {
          response = 'No encontré ese ítem en el menú. Mandá un número de la lista.';
        }
      } else if (intent.intent === 'CANCEL') {
        newState = STATES.GREETING;
        context.currentOrder = [];
        response = 'Listo, cancelado. Cuando quieras pedir, escribí *menu*.';
      } else if (intent.intent === 'START') {
        const items = loadMenuIntoContext(tenant_id, context);
        response = getResponse(STATES.MENU, { items });
      } else {
        response = 'Mandá el número del ítem que querés, o escribí *cancelar* para salir.';
      }
      break;
    }

    case STATES.ORDERING: {
      if (intent.intent === 'SELECT_ITEM') {
        const item = findItem(context.lastMenuItems, intent);
        if (item) {
          addToOrder(context.currentOrder, item);
          response = getResponse(STATES.ORDERING, {
            lastItem: item,
            order: context.currentOrder,
          });
        } else {
          response = 'No encontré ese ítem. Mandá un número del menú.';
        }
      } else if (intent.intent === 'REMOVE_ITEM') {
        const removed = removeFromOrder(context.currentOrder, intent.name);
        if (!removed) {
          response =
            'No encontré ese ítem en tu pedido.\n\n' +
            getResponse(STATES.ORDERING, { order: context.currentOrder });
        } else if (context.currentOrder.length === 0) {
          const items = loadMenuIntoContext(tenant_id, context);
          newState = STATES.MENU;
          response =
            `Quité *${removed.name}* del pedido. Tu carrito está vacío.\n\n` +
            getResponse(STATES.MENU, { items });
        } else {
          response =
            `Quité *${removed.name}* del pedido.\n\n` +
            getResponse(STATES.ORDERING, { order: context.currentOrder });
        }
      } else if (intent.intent === 'CONFIRM') {
        newState = STATES.CONFIRM;
        response = getResponse(STATES.CONFIRM, { order: context.currentOrder });
      } else if (intent.intent === 'CANCEL') {
        newState = STATES.GREETING;
        context.currentOrder = [];
        response = 'Pedido cancelado. Cuando quieras, escribí *menu*.';
      } else if (intent.intent === 'START') {
        const items = loadMenuIntoContext(tenant_id, context);
        response = getResponse(STATES.MENU, { items });
      } else {
        response = 'Mandá otro número para agregar, o escribí *confirmar* para terminar.';
      }
      break;
    }

    case STATES.CONFIRM: {
      if (intent.intent === 'CONFIRM') {
        const total = context.currentOrder.reduce(
          (s, i) => s + i.price * i.quantity,
          0,
        );
        const orderId = saveOrder(tenant_id, phone, context.currentOrder, total);
        const tenant = getTenantById(tenant_id);
        const bankInfo = tenant && tenant.config;

        if (hasBankInfo(bankInfo)) {
          newState = STATES.AWAITING_PAYMENT;
          response = getResponse(STATES.AWAITING_PAYMENT, { bankInfo, total });
        } else {
          newState = STATES.DONE;
          response = getResponse(STATES.DONE, { orderId });
          context.currentOrder = [];
          context.lastMenuItems = [];
        }
      } else if (intent.intent === 'CANCEL') {
        newState = STATES.GREETING;
        context.currentOrder = [];
        response = 'Pedido cancelado. Cuando quieras, escribí *menu*.';
      } else {
        response = 'Necesito que me digas *sí* para confirmar o *no* para cancelar.';
      }
      break;
    }

    case STATES.AWAITING_PAYMENT: {
      if (intent.intent === 'PAYMENT_SENT' || intent.intent === 'CONFIRM') {
        newState = STATES.PAYMENT_SENT;
        context.currentOrder = [];
        context.lastMenuItems = [];
        response = getResponse(STATES.PAYMENT_SENT);
      } else {
        response =
          'Aún esperamos tu pago. Cuando lo hayas hecho, escribí *transferí* o *listo*.';
      }
      break;
    }

    case STATES.PAYMENT_SENT: {
      if (intent.intent === 'START') {
        const items = loadMenuIntoContext(tenant_id, context);
        context.currentOrder = [];
        newState = STATES.MENU;
        response =
          getResponse(STATES.GREETING) + '\n\n' + getResponse(STATES.MENU, { items });
      } else {
        response = 'Tu pago está siendo verificado. Te avisamos pronto.';
      }
      break;
    }

    default:
      newState = STATES.GREETING;
      response = '¿Querés hacer un pedido? Escribí *hola*.';
  }

  updateConversationState(tenant_id, phone, newState, context);
  return response;
}

module.exports = { processMessage };
