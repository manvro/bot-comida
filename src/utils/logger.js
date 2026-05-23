const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', '..', 'logs');
const API_LOG_FILE = path.join(LOG_DIR, 'api-calls.log');

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function logApiCall(tenant_id, phone, message, tokensUsed) {
  const timestamp = new Date().toISOString();
  const safeMsg = String(message || '').replace(/\s+/g, ' ').slice(0, 200);
  const line = `[${timestamp}] tenant:${tenant_id} phone:${phone} tokens:${tokensUsed} msg:"${safeMsg}"`;
  fs.appendFileSync(API_LOG_FILE, line + '\n', 'utf8');
  console.log(line);
}

module.exports = { logApiCall };
