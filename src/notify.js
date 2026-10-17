// Повідомлення Ользі від бота.
import { config } from './config.js';
import { t, tHtml, escapeHtml, KEYS } from './texts.js';
import { rememberOwnerMessage } from './db.js';

let api = null;
export function setApi(botApi) {
  api = botApi;
}
export function getApi() {
  return api;
}

// Кнопки під повідомленнями людині
export const doneKeyboard = () => ({
  inline_keyboard: [[{ text: t(KEYS.doneButton), callback_data: 'screens_done' }]],
});
export const diagnosticsKeyboard = () => ({
  inline_keyboard: [[{ text: t(KEYS.diagnosticsButton), callback_data: 'diag' }]],
});
export const shareContactKeyboard = () => ({
  keyboard: [[{ text: t(KEYS.shareContactButton), request_contact: true }]],
  resize_keyboard: true,
  one_time_keyboard: true,
});

export function personVars(person, extra = {}) {
  return { name: person.name, tg: person.tg_username, ig: person.ig, ...extra };
}

// Ім'я людини як посилання на її профіль у Telegram: працює навіть без ніка.
export function nameLink(person) {
  const name = escapeHtml(person.name || 'Без імені');
  return `<a href="tg://user?id=${person.tg_id}">${name}</a>`;
}

// Надсилає Ользі повідомлення за шаблоном з texts/messages.md (ім'я — посилання на профіль)
// і запам'ятовує, від якої людини воно, щоб її Reply дійшов цій людині.
export async function notifyOwner(person, title, vars = {}, extra = {}, appendTitle = null) {
  let text = tHtml(title, personVars(person, vars), { name: nameLink(person) });
  if (appendTitle) text += '\n\n' + tHtml(appendTitle, personVars(person, vars));
  return sendToOwner(person, text, { parse_mode: 'HTML', ...extra });
}

async function sendToOwner(person, text, extra) {
  if (!config.ownerId) {
    console.warn('OWNER_TELEGRAM_ID не задано — сповіщення Ользі не надіслано:', text.slice(0, 100));
    return null;
  }
  const opts = { link_preview_options: { is_disabled: true }, ...extra };
  try {
    const msg = await api.sendMessage(config.ownerId, text, opts);
    if (person) rememberOwnerMessage(msg.message_id, person.tg_id);
    return msg;
  } catch (e) {
    // Якщо Telegram не прийняв розмітку чи посилання на профіль — надсилаємо простим текстом.
    if (opts.parse_mode === 'HTML' && e.error_code === 400) {
      const plain = text
        .replace(/<[^>]+>/g, '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
      delete opts.parse_mode;
      return sendToOwner(person, plain, opts);
    }
    console.error('Не вдалося надіслати сповіщення Ользі:', e.message);
    return null;
  }
}

// Зрозуміле пояснення найчастіших помилок + технічний текст для Claude.
export function explainError(err) {
  if (!err) return 'невідома';
  const e = err.toLowerCase();
  let hint = '';
  if (e.includes('credit balance') || e.includes('billing')) hint = 'закінчився баланс Claude API (console.anthropic.com → Billing)';
  else if (e.includes('apify') && (e.includes('402') || e.includes('usage') || e.includes('limit'))) hint = 'закінчився ліміт Apify (apify.com → Billing)';
  else if (e.includes('apify') && (e.includes('408') || e.includes('timeout') || e.includes('timed out'))) hint = 'Apify не встиг прочитати сторінку';
  else if (e.includes('401') || e.includes('authentication') || e.includes('invalid x-api-key')) hint = 'не приймається ключ (перевір ключі в Railway)';
  else if (e.includes('overloaded') || e.includes('529')) hint = 'Claude був перевантажений';
  else if (e.includes('telegram')) hint = 'не вдалося надіслати людині (можливо, вона заблокувала бота)';
  return hint ? `${hint}. Технічно: ${err}` : err;
}

export function notifyAuditFailed(person) {
  return notifyOwner(person, KEYS.ownerAuditFailed, { error: explainError(person.last_error) });
}
