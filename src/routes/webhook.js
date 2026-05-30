const express = require('express');
const { getTenantByNumber } = require('../db/queries');
const { processMessage } = require('../bot/engine');
// Agregar estas dos líneas aquí:
const twilio = require('twilio');
const WEBHOOK_URL = process.env.WEBHOOK_URL || '';

const router = express.Router();

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function twiml(text) {
  if (text == null || text === '') {
    return '<?xml version="1.0" encoding="UTF-8"?>\n<Response></Response>';
  }
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<Response><Message>${escapeXml(text)}</Message></Response>`
  );
}

function validateTwilioSignature(req, res, next) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!authToken) {
    console.warn('[webhook] TWILIO_AUTH_TOKEN no configurado, saltando validación');
    return next();
  }

  if (!WEBHOOK_URL) {
    console.warn('[webhook] WEBHOOK_URL no configurado, saltando validación');
    return next();
  }

  const signature = req.headers['x-twilio-signature'] || '';
  const valid = twilio.validateRequest(authToken, signature, WEBHOOK_URL, req.body);

  if (!valid) {
    console.warn('[webhook] Firma inválida — request rechazado');
    return res.status(403).send(twiml(null));
  }

  next();
}

router.post('/', validateTwilioSignature, async (req, res) => {
  res.set('Content-Type', 'text/xml');

  try {
    const fromRaw = req.body.From || '';
    const toRaw = req.body.To || '';
    const body = req.body.Body || '';
    const numMedia = parseInt(req.body.NumMedia || '0', 10);
    if (numMedia > 0 || !body.trim()) {
      return res.send(twiml('Solo proceso texto. Escribe hola para ver el menú.'));
    }

    const phone = fromRaw.replace(/^whatsapp:/, '').trim();
    const destNumber = toRaw.replace(/^whatsapp:/, '').trim();

    console.log(`[webhook] ${phone} -> ${destNumber}: "${body}"`);

    if (!phone || !destNumber) {
      return res.send(twiml(null));
    }

    const tenant = getTenantByNumber(destNumber);
    if (!tenant) {
      console.warn(`[webhook] tenant no encontrado para número ${destNumber}`);
      return res.send(twiml(null));
    }

    const responseText = await processMessage(tenant.id, phone, body);
    console.log(`[webhook] response para ${phone}: ${JSON.stringify(responseText?.slice(0, 60))}`);
    if (responseText == null) {
      return res.send(
        twiml('Lo siento, no pude procesar tu mensaje. Escribí *hola* para empezar.'),
      );
    }

    return res.send(twiml(responseText));
  } catch (err) {
    console.error('[webhook] Error procesando mensaje:', err);
    return res.send(
      twiml('Tuvimos un problema técnico. Intentá de nuevo en un momento.'),
    );
  }
});

module.exports = router;
