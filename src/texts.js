// Читає тексти бота з texts/messages.md.
// Кожен текст — під заголовком «## Назва». Слова в {дужках} замінюються на дані людини.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FILE = fileURLToPath(new URL('../texts/messages.md', import.meta.url));

export const KEYS = {
  greetingWithNick: 'Привітання (є нік)',
  greetingNoNick: 'Привітання (немає ніка)',
  nickInvalid: 'Нік не розпізнано',
  pageUnreadable: 'Сторінку не прочитано',
  doneButton: 'Кнопка «Готово»',
  noScreenshotsYet: 'Скріншотів ще немає',
  screenshotsReceived: 'Скріншоти отримано',
  repeatInWork: 'Повторний старт (аудит у роботі)',
  repeatSent: 'Повторний старт (аудит надіслано)',
  auditHeader: 'Заголовок аудиту',
  diagnosticsButton: 'Кнопка під аудитом',
  afterDiagnostics: 'Після натискання «Діагностика»',
  afterDiagnosticsNoNick: 'Після натискання «Діагностика» (немає ніка в Telegram)',
  shareContactButton: 'Кнопка «Поділитися номером»',
  contactReceived: 'Номер отримано',
  freeTextReply: 'Відповідь на вільне повідомлення',
  ownerPhone: 'Ользі — номер телефону',
  ownerDiagnostics: 'Ользі — заявка на діагностику',
  ownerChatButton: 'Ользі — кнопка чату',
  ownerNoTgNick: 'Ользі — немає ніка в Telegram',
  ownerForwarded: 'Ользі — переслане повідомлення',
  ownerAuditFailed: 'Ользі — аудит не вдався',
};

export function parseMessages(markdown) {
  const sections = {};
  let current = null;
  let lines = [];
  const flush = () => {
    if (current) sections[current] = lines.join('\n').trim();
  };
  for (const line of markdown.split(/\r?\n/)) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      flush();
      current = m[1];
      lines = [];
    } else if (current) {
      lines.push(line);
    }
  }
  flush();
  return sections;
}

const sections = parseMessages(readFileSync(FILE, 'utf8'));

// Якщо Ольга випадково змінила заголовок, бот повідомить про це в логах одразу при запуску.
export const missingKeys = Object.values(KEYS).filter((title) => !sections[title]);
if (missingKeys.length) {
  console.error('У texts/messages.md не знайдено розділів:', missingKeys.join(', '));
}

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Те саме, що t(), але для повідомлень з HTML-розміткою (parse_mode: 'HTML').
// Текст і дані екрануються; значення з rawHtml вставляються як готова розмітка (наприклад, посилання).
export function tHtml(title, vars = {}, rawHtml = {}) {
  const text = sections[title];
  if (!text) return escapeHtml(`[немає тексту «${title}» у texts/messages.md]`);
  return escapeHtml(text).replace(/\{(\w+)\}/g, (whole, key) => {
    if (rawHtml[key] !== undefined) return rawHtml[key];
    const v = vars[key];
    return v === undefined || v === null || v === '' ? '—' : escapeHtml(v);
  });
}
export { escapeHtml };

// t(KEYS.greetingWithNick, { ig: 'nick' }) → готовий текст
export function t(title, vars = {}) {
  const text = sections[title];
  if (!text) return `[немає тексту «${title}» у texts/messages.md]`;
  return text.replace(/\{(\w+)\}/g, (whole, key) =>
    vars[key] === undefined || vars[key] === null || vars[key] === '' ? '—' : String(vars[key]),
  );
}
