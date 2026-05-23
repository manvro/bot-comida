const {
  getTenantByNumber,
  saveOrder,
  getOrdersByDate,
  getOrCreateConversation,
  updateConversationState,
  pauseConversation,
  resumeConversation,
  getPausedConversations,
} = require('./queries');

console.log('=== TEST DB ===\n');

console.log('1) Buscar tenant demo por número:');
const tenant = getTenantByNumber('+56900000000');
console.log(tenant);
if (!tenant) {
  console.error('No se encontró el tenant demo. Abortando.');
  process.exit(1);
}
console.log();

const clientPhone = '+56911112222';

console.log(`2) Crear/obtener conversación para ${clientPhone}:`);
let conv = getOrCreateConversation(tenant.id, clientPhone);
console.log(conv);
console.log();

console.log('3) Actualizar estado de la conversación a "tomando_pedido":');
updateConversationState(tenant.id, clientPhone, 'tomando_pedido', { intento: 1 });
conv = getOrCreateConversation(tenant.id, clientPhone);
console.log(conv);
console.log();

console.log('4) Guardar un pedido con 2 ítems:');
const items = [
  { name: 'Empanada de carne', qty: 2, price: 1500 },
  { name: 'Coca-Cola 500ml', qty: 1, price: 1800 },
];
const total = items.reduce((sum, i) => sum + i.qty * i.price, 0);
const orderId = saveOrder(tenant.id, clientPhone, items, total);
console.log(`   → Pedido guardado con id=${orderId}, total=${total}`);
console.log();

const today = new Date().toISOString().slice(0, 10);
console.log(`5) Leer pedidos de hoy (${today}):`);
const todays = getOrdersByDate(tenant.id, today);
console.log(todays);
console.log();

console.log('6) Pausar la conversación:');
pauseConversation(tenant.id, clientPhone);
console.log('   → pausada');

console.log('7) Listar conversaciones pausadas:');
const paused = getPausedConversations(tenant.id);
console.log(paused);
console.log();

console.log('8) Reanudar la conversación:');
resumeConversation(tenant.id, clientPhone);
const pausedAfter = getPausedConversations(tenant.id);
console.log(`   → pausadas ahora: ${pausedAfter.length}`);
console.log();

console.log('=== TEST OK ===');
