const { STATES } = require('./states');

function formatPrice(price) {
  return `$${price}`;
}

function formatMenu(items) {
  if (!items || items.length === 0) {
    return 'No hay ítems disponibles en el menú por ahora.';
  }

  const grouped = {};
  items.forEach((item, idx) => {
    const cat = item.category || 'Otros';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push({ ...item, number: idx + 1 });
  });

  const lines = ['Este es nuestro menú:', ''];
  for (const [cat, list] of Object.entries(grouped)) {
    lines.push(`*${cat}*`);
    for (const it of list) {
      lines.push(`${it.number}. ${it.name} - ${formatPrice(it.price)}`);
    }
    lines.push('');
  }
  lines.push('Responde con el número del ítem que quieres.');
  return lines.join('\n').trim();
}

function formatOrderLines(order) {
  let total = 0;
  const lines = [];
  for (const it of order) {
    const subtotal = it.price * it.quantity;
    total += subtotal;
    lines.push(`- ${it.quantity}x ${it.name} - ${formatPrice(subtotal)}`);
  }
  return { lines: lines.join('\n'), total };
}

function getResponse(state, data = {}) {
  switch (state) {
    case STATES.GREETING:
      return '¡Hola! Bienvenido. ¿Quieres hacer un pedido?';

    case STATES.MENU:
      return formatMenu(data.items || []);

    case STATES.ORDERING: {
      const { lines, total } = formatOrderLines(data.order || []);
      const intro = data.lastItem
        ? `Agregué *${data.lastItem.name}* a tu pedido.\n\n`
        : '';
      return (
        `${intro}Tu pedido hasta ahora:\n${lines}\n\n` +
        `Total parcial: ${formatPrice(total)}\n\n` +
        '¿Quieres agregar algo más? Manda otro número, o escribe *confirmar* para terminar.'
      );
    }

    case STATES.CONFIRM: {
      const { lines, total } = formatOrderLines(data.order || []);
      return (
        `Tu pedido:\n${lines}\n\n` +
        `Total: ${formatPrice(total)}\n\n` +
        '¿Confirmas? (sí / no)'
      );
    }

    case STATES.AWAITING_PAYMENT: {
      const bank = data.bankInfo || {};
      const lines = [
        `Total a transferir: ${formatPrice(data.total || 0)}`,
        '',
        '*Datos para la transferencia:*',
      ];
      if (bank.bankName)      lines.push(`Banco: ${bank.bankName}`);
      if (bank.bankType)      lines.push(`Tipo de cuenta: ${bank.bankType}`);
      if (bank.accountNumber) lines.push(`Número de cuenta: ${bank.accountNumber}`);
      if (bank.accountHolder) lines.push(`Titular: ${bank.accountHolder}`);
      if (bank.rut)           lines.push(`RUT: ${bank.rut}`);
      lines.push('', 'Cuando hayas hecho la transferencia, escribí *transferí* o *listo*.');
      return lines.join('\n');
    }

    case STATES.PAYMENT_SENT:
      return '¡Gracias! Confirmaremos tu pago pronto.';

    case STATES.DONE:
      return `¡Listo! Pedido #${data.orderId} registrado. Te avisaremos cuando esté listo. ¡Gracias!`;

    case STATES.PAUSED:
      return 'Un momento, te conecto con una persona del local. Te respondemos en breve.';

    default:
      return '';
  }
}

module.exports = { getResponse };