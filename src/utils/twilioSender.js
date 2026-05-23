const twilio = require('twilio');

let cachedClient = null;

function getClient() {
  if (cachedClient) return cachedClient;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    console.error(
      '[twilioSender] Faltan TWILIO_ACCOUNT_SID o TWILIO_AUTH_TOKEN en .env',
    );
    return null;
  }
  cachedClient = twilio(sid, token);
  return cachedClient;
}

function withWhatsAppPrefix(number) {
  if (!number) return null;
  return number.startsWith('whatsapp:') ? number : `whatsapp:${number}`;
}

async function sendMessage(to, text) {
  const client = getClient();
  if (!client) return null;

  const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER;
  if (!fromNumber) {
    console.error('[twilioSender] Falta TWILIO_WHATSAPP_NUMBER en .env');
    return null;
  }

  try {
    const message = await client.messages.create({
      from: withWhatsAppPrefix(fromNumber),
      to: withWhatsAppPrefix(to),
      body: text,
    });
    return message.sid;
  } catch (err) {
    console.error('[twilioSender] Error enviando mensaje:', err.message);
    return null;
  }
}

module.exports = { sendMessage };
