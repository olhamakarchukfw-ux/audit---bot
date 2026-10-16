// Точка входу: веб-сервер (адреса /go для ManyChat) + Telegram-бот.
import http from 'node:http';
import { GrammyError } from 'grammy';
import { config, requireBotToken } from './config.js';

requireBotToken();

const { createStartCode } = await import('./db.js');
const { normalizeIg } = await import('./nick.js');
const { bot } = await import('./bot.js');
const { startWorker } = await import('./audit.js');

// ---------- Веб-сервер ----------

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/' || url.pathname === '/health') return send(res, 200, 'ok');

  // ManyChat веде сюди: /go?ig=нік → запам'ятовуємо нік під кодом → відкриваємо бот.
  if (url.pathname === '/go') {
    if (!config.botUsername) return send(res, 500, 'Не налаштовано BOT_USERNAME');
    const ig = normalizeIg(url.searchParams.get('ig') || '');
    let target = `https://t.me/${config.botUsername}`;
    if (ig) {
      try {
        target += `?start=${createStartCode(ig)}`;
      } catch (e) {
        console.error('Не вдалося зберегти код старту:', e);
      }
    } else {
      console.warn('Перехід /go без коректного ніка:', url.searchParams.get('ig'));
    }
    return send(res, 302, '', { Location: target, 'Cache-Control': 'no-store' });
  }

  return send(res, 404, 'not found');
});
server.listen(config.port, () => console.log(`Веб-сервер слухає порт ${config.port}`));

// ---------- Бот ----------

// Під час нового деплою стара копія ще кілька секунд працює,
// і Telegram відповідає 409 — тоді просто чекаємо й пробуємо знову.
let stopping = false;
async function startBot() {
  while (!stopping) {
    try {
      await bot.start({ onStart: (me) => console.log(`Бот @${me.username} запущено`) });
      return;
    } catch (e) {
      if (stopping) return;
      if (e instanceof GrammyError && e.error_code === 409) {
        console.warn('Інша копія бота ще працює, повторюю за 5 секунд…');
      } else if (e instanceof GrammyError && e.error_code === 401) {
        console.error('Telegram не приймає BOT_TOKEN. Перевір токен у Railway → Variables.');
        await new Promise((r) => setTimeout(r, 60000));
        continue;
      } else {
        console.error('Бот зупинився з помилкою, перезапуск за 5 секунд:', e);
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}
startBot();
startWorker();

// Попередження в логах, якщо чогось не вистачає (бот при цьому працює).
for (const [name, value] of [
  ['ANTHROPIC_API_KEY', config.anthropicKey],
  ['APIFY_TOKEN', config.apifyToken],
  ['OWNER_TELEGRAM_ID', config.ownerId],
  ['SHEETS_WEBHOOK_URL', config.sheetsUrl],
]) {
  if (!value) console.warn(`Увага: не задано ${name} у Railway → Variables`);
}

async function shutdown(signal) {
  console.log(`Отримано ${signal}, зупиняюсь…`);
  stopping = true;
  await bot.stop().catch(() => {});
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
