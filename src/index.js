// Точка входу. Крок 3: мінімальний бот (/start, /id) + веб-сервер для Railway.
import http from 'node:http';
import { Bot, GrammyError, HttpError } from 'grammy';
import { config, requireBotToken } from './config.js';
import { t, KEYS } from './texts.js';

requireBotToken();

const bot = new Bot(config.botToken);

// /id — службова команда: показує Telegram ID (потрібна, щоб налаштувати сповіщення Ользі).
bot.command('id', (ctx) =>
  ctx.reply(`Твій Telegram ID: ${ctx.from.id}\n\nСкопіюй це число в Railway → Variables → OWNER_TELEGRAM_ID.`),
);

// /start — поки що завжди просить нік (передачу ніка з ManyChat додаємо на кроці 4).
bot.command('start', (ctx) => ctx.reply(t(KEYS.greetingNoNick)));

bot.catch((err) => {
  const e = err.error;
  if (e instanceof GrammyError) console.error('Помилка Telegram:', e.description);
  else if (e instanceof HttpError) console.error('Немає зв\'язку з Telegram:', e);
  else console.error('Помилка в обробнику:', e);
});

// Веб-сервер: Railway перевіряє, що бот живий; на кроці 4 тут з'явиться адреса /go.
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/' || url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('ok');
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('not found');
});
server.listen(config.port, () => console.log(`Веб-сервер слухає порт ${config.port}`));

// Запуск бота. Під час нового деплою стара копія ще кілька секунд працює,
// і Telegram відповідає 409 — тоді просто чекаємо й пробуємо знову.
let stopping = false;
async function startBot() {
  while (!stopping) {
    try {
      await bot.start({
        drop_pending_updates: false,
        onStart: (me) => console.log(`Бот @${me.username} запущено`),
      });
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

async function shutdown(signal) {
  console.log(`Отримано ${signal}, зупиняюсь…`);
  stopping = true;
  await bot.stop().catch(() => {});
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
