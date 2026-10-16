// Відправка даних у Google-таблицю через опублікований Apps Script.
// Рядок шукається за ніком Instagram: якщо є — оновлюється, якщо немає — додається.
import { config } from './config.js';
import { STATUS_LABEL } from './db.js';

export function formatKyiv(ms) {
  return new Intl.DateTimeFormat('uk-UA', {
    timeZone: config.timezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(new Date(ms))
    .replace(',', '');
}

async function post(payload) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(config.sheetsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        redirect: 'follow',
        signal: AbortSignal.timeout(30000),
      });
      const text = await res.text();
      let data = null;
      try {
        data = JSON.parse(text);
      } catch {
        // Google повернув сторінку замість JSON (наприклад, доступ не «Anyone»)
      }
      if (data?.ok) return true;
      console.error(`Таблиця відповіла помилкою (спроба ${attempt}):`, data?.error || text.slice(0, 200));
      if (data?.error === 'wrong secret') return false; // повтор не допоможе
    } catch (e) {
      console.error(`Не вдалося надіслати в таблицю (спроба ${attempt}):`, e.message);
    }
    await new Promise((r) => setTimeout(r, attempt * 3000));
  }
  return false;
}

// Записи йдуть по черзі, щоб статуси не переплуталися місцями.
let queue = Promise.resolve();

// extra: { analysis, text } — додаткові колонки, коли вони з'являються.
export function syncRow(person, extra = {}) {
  if (!config.sheetsUrl || !person?.ig) return Promise.resolve(false);
  const payload = {
    secret: config.sheetsSecret || '',
    date: formatKyiv(person.created_at),
    ig: person.ig,
    name: person.name || '',
    tg: person.tg_username ? '@' + person.tg_username : '',
    status: STATUS_LABEL[person.status] || person.status,
    ...extra,
  };
  queue = queue.then(() => post(payload)).catch(() => false);
  return queue;
}
