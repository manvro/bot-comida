const express = require('express');
const bcrypt = require('bcrypt');
const { getUserByEmail } = require('../db/queries');
const { signToken } = require('../middleware/auth');

const router = express.Router();

const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const BLOCK_MS = 15 * 60 * 1000;

function checkRateLimit(email) {
  const now = Date.now();
  const entry = loginAttempts.get(email);
  if (!entry) return false;
  if (now - entry.firstAttempt > BLOCK_MS) {
    loginAttempts.delete(email);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

function recordFailedAttempt(email) {
  const now = Date.now();
  const entry = loginAttempts.get(email);
  if (!entry || now - entry.firstAttempt > BLOCK_MS) {
    loginAttempts.set(email, { count: 1, firstAttempt: now });
  } else {
    entry.count++;
  }
}

function clearAttempts(email) {
  loginAttempts.delete(email);
}

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: 'Email y contraseña requeridos' });
  }

  if (checkRateLimit(email)) {
    return res.status(429).json({ error: 'Demasiados intentos. Espera 15 minutos.' });
  }

  const user = getUserByEmail(email.toLowerCase().trim());

  const dummyHash = '$2b$10$invalidhashtopreventtimingattacks000000000000000000000';
  const hash = user ? user.password_hash : dummyHash;
  const match = await bcrypt.compare(password, hash);

  if (!user || !match) {
    recordFailedAttempt(email);
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }

  clearAttempts(email);

  const token = signToken({
    userId: user.id,
    tenantId: user.tenant_id,
    email: user.email,
  });

  res.json({ token, tenantId: user.tenant_id });
});

module.exports = router;