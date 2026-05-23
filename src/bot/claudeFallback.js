const Anthropic = require('@anthropic-ai/sdk');
const { getMenuFromCache } = require('../utils/menuLoader');

const MODEL = 'claude-haiku-4-5';
const MAX_TOKENS = 300;

const FALLBACK_ERROR_TEXT =
  "Lo siento, tuve un problema técnico. Escribí 'hola' para reintentar.";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function buildSystemPrompt(menuItems, conversationContext) {
  const menuLines = menuItems.map(
    (i) => `- ${i.name} ($${i.price})${i.category ? ` [${i.category}]` : ''}`,
  );

  const cartLines =
    conversationContext &&
    Array.isArray(conversationContext.currentOrder) &&
    conversationContext.currentOrder.length > 0
      ? conversationContext.currentOrder.map(
          (it) => `- ${it.quantity}x ${it.name} ($${it.price * it.quantity})`,
        )
      : null;

  const parts = [
    'Sos un asistente de pedidos por WhatsApp para un restaurante.',
    '',
    'Reglas estrictas:',
    '- Hablá SOLO del menú de abajo. NO inventes ítems ni precios que no estén en la lista.',
    '- Si el cliente pregunta por algo que no está en el menú, decílo claramente.',
    '- Si el cliente quiere hacer un pedido, indicale que escriba el NÚMERO del ítem del menú.',
    '- Si el cliente pregunta algo no relacionado al restaurante, redirigilo amablemente al pedido.',
    '- Respondé en español, máximo 3 líneas. Es WhatsApp, sé breve y directo.',
    '- No uses emojis.',
    '',
    'Menú actual disponible:',
    ...menuLines,
  ];

  if (cartLines) {
    parts.push('', 'Pedido actual del cliente:', ...cartLines);
  }

  return parts.join('\n');
}

async function askClaude(tenant_id, phone, userMessage, conversationContext) {
  try {
    const menuItems = getMenuFromCache(tenant_id);
    const system = buildSystemPrompt(menuItems, conversationContext);

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages: [{ role: 'user', content: userMessage }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    const text = textBlock ? textBlock.text.trim() : '';

    return {
      text: text || FALLBACK_ERROR_TEXT,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  } catch (err) {
    console.error('[claudeFallback] Error llamando a Claude:', err.message);
    return {
      text: FALLBACK_ERROR_TEXT,
      inputTokens: 0,
      outputTokens: 0,
    };
  }
}

module.exports = { askClaude };
