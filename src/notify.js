// Повідомлення Ользі від бота.
import { config } from './config.js';
import { t, KEYS } from './texts.js';
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

export function personVars(person, extra = {}) {
  return { name: person.name, tg: person.tg_username, ig: person.ig, ...extra };
}

// Надсилає Ользі текст і запам'ятовує, від якої людини він, щоб її Reply дійшов цій людині.
export async function notifyOwner(person, text, extra = {}) {
  if (!config.ownerId) {
    console.warn('OWNER_TELEGRAM_ID не задано — сповіщення Ользі не надіслано:', text.slice(0, 100));
    return null;
  }
  try {
    const msg = await api.sendMessage(config.ownerId, text, { link_preview_options: { is_disabled: true }, ...extra });
    if (person) rememberOwnerMessage(msg.message_id, person.tg_id);
    return msg;
  } catch (e) {
    console.error('Не вдалося надіслати сповіщення Ользі:', e.message);
    return null;
  }
}

export function notifyAuditFailed(person) {
  return notifyOwner(person, t(KEYS.ownerAuditFailed, personVars(person)));
}
