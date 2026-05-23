const db = require('../db/database');
const {
  getTenantByNumber,
  resumeConversation,
  updateConversationState,
} = require('../db/queries');
const { loadMenu } = require('../utils/menuLoader');
const { processMessage } = require('./engine');

const TEST_PHONE = '+56999998888';
const HANDOFF_PHONE = '+56977776666';

db.prepare('DELETE FROM conversations WHERE phone IN (?, ?)').run(TEST_PHONE, HANDOFF_PHONE);
db.prepare('DELETE FROM orders WHERE phone IN (?, ?)').run(TEST_PHONE, HANDOFF_PHONE);

const tenant = getTenantByNumber('+56900000000');
if (!tenant) {
  console.error('No se encontró el tenant demo.');
  process.exit(1);
}

loadMenu(tenant.id);

console.log('=== Simulación de conversación ===');
console.log(`Tenant : ${tenant.name}`);
console.log(`Cliente: ${TEST_PHONE}`);

async function step(text, phone = TEST_PHONE) {
  console.log('\n' + '-'.repeat(60));
  console.log(`USUARIO (${phone}) -> ${text}`);
  const response = await processMessage(tenant.id, phone, text);
  if (response === null) {
    console.log('BOT     -> [null: motor no entendió y no hubo fallback]');
  } else {
    console.log('BOT     ->');
    console.log(response.split('\n').map(l => '          ' + l).join('\n'));
  }
}

(async () => {
  await step('cuántas calorías tiene la milanesa?');
  await step('hola');
  await step('1');
  await step('coca');
  await step('confirmar');
  await step('si');

  console.log('\n' + '='.repeat(60));
  console.log('Pedido guardado en DB:');
  const orders = db
    .prepare('SELECT id, tenant_id, phone, items, total, status, created_at FROM orders WHERE phone = ?')
    .all(TEST_PHONE);
  console.log(
    JSON.stringify(
      orders.map(o => ({ ...o, items: JSON.parse(o.items) })),
      null,
      2,
    ),
  );

  console.log('\n' + '='.repeat(60));
  console.log(`Prueba de handoff automático (umbral unknownCount=3) — cliente ${HANDOFF_PHONE}`);

  await step('asdfgh1', HANDOFF_PHONE);
  await step('qwerty2', HANDOFF_PHONE);
  await step('zxcvbn3', HANDOFF_PHONE);
  await step('cualquier cosa que mande ahora', HANDOFF_PHONE);

  console.log('\nReanudando manualmente (simula POST /admin/resume)...');
  resumeConversation(tenant.id, HANDOFF_PHONE);
  const after = db
    .prepare('SELECT state, context FROM conversations WHERE tenant_id = ? AND phone = ?')
    .get(tenant.id, HANDOFF_PHONE);
  const ctx = JSON.parse(after.context || '{}');
  ctx.unknownCount = 0;
  updateConversationState(tenant.id, HANDOFF_PHONE, after.state, ctx);
  console.log(`Conversación reanudada. unknownCount reseteado a 0.`);

  await step('hola', HANDOFF_PHONE);
})();
