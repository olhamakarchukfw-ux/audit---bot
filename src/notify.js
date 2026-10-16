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

export function notifyAuditFailed(person) {
  return notifyOwner(person, KEYS.ownerAuditFailed);
}
