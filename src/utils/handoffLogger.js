const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', '..', 'logs');
const HANDOFF_LOG_FILE = path.join(LOG_DIR, 'handoff.log');

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function logHandoff(tenant_id, phone, reason) {
  const timestamp = new Date().toISOString();
  const safeReason = String(reason || '').replace(/\s+/g, ' ').slice(0, 200);
  const line = `[${timestamp}] tenant:${tenant_id} phone:${phone} reason:"${safeReason}"`;
  fs.appendFileSync(HANDOFF_LOG_FILE, line + '\n', 'utf8');
  console.log(`[HANDOFF] ${line}`);
}

module.exports = { logHandoff };
