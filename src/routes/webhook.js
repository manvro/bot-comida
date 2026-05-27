const express = require('express');
const { getTenantByNumber } = require('../db/queries');
const { processMessage } = require('../bot/engine');

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

router.post('/', async (req, res) => {
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
