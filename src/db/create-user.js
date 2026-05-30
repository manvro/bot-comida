const bcrypt = require('bcrypt');

// Inicializa la DB primero
require('./database');

const { createUser, getUserByEmail } = require('./queries');

const [,, email, password, tenantId] = process.argv;

if (!email || !password) {
  console.error('Uso: node src/db/create-user.js <email> <password> [tenant_id=1]');
  process.exit(1);
}

const tid = parseInt(tenantId || '1', 10);

if (getUserByEmail(email)) {
  console.error('Ya existe un usuario con ese email');
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 10);
const id = createUser(tid, email.toLowerCase().trim(), hash);
console.log(`✓ Usuario creado: id=${id}, email=${email}, tenant_id=${tid}`);
process.exit(0);