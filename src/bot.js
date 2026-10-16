// Логіка Telegram-бота.
import { Bot, GrammyError, HttpError } from 'grammy';
import { config } from './config.js';
import { t, KEYS } from './texts.js';
import { STATUS, getPerson, upsertPerson, updatePerson, deletePerson, resolveStartCode } from './db.js';
import { normalizeIg } from './nick.js';
import { syncRow } from './sheets.js';
import { startAudit } from './audit.js';

export const bot = new Bot(config.botToken);

// Аудит уже розпочато для цієї людини (повторний «Старт» не запускає новий).
const STARTED = new Set([
  STATUS.IN_WORK, STATUS.AWAITING_SCREENS, STATUS.READY,
  STATUS.SENT, STATUS.DIAGNOSTICS, STATUS.ERROR,
]);

async function beginAudit(ctx, ig) {
  const person = updatePerson(ctx.from.id, {
    ig,
    status: STATUS.IN_WORK,
    attempts: 0,
    next_try_at: Date.now(),
  });
  await ctx.reply(t(KEYS.greetingWithNick, { ig }));
  syncRow(person);
  startAudit(person).catch((e) => console.error('Помилка запуску аудиту:', e));
}

async function replyRepeatStart(ctx, person) {
  if (person.status === STATUS.SENT || person.status === STATUS.DIAGNOSTICS) {
    return ctx.reply(t(KEYS.repeatSent));
  }
  if (person.status === STATUS.AWAITING_SCREENS) {
    return ctx.reply(t(KEYS.pageUnreadable, { ig: person.ig }), {
      reply_markup: { inline_keyboard: [[{ text: t(KEYS.doneButton), callback_data: 'screens_done' }]] },
    });
  }
  return ctx.reply(t(KEYS.repeatInWork));
}

// /id — службова команда: показує Telegram ID.
bot.command('id', (ctx) =>
  ctx.reply(`Твій Telegram ID: ${ctx.from.id}\n\nСкопіюй це число в Railway → Variables → OWNER_TELEGRAM_ID.`),
);

// /reset — лише для Ольги: стирає її власний запис, щоб пройти шлях від початку під час тестів.
bot.command('reset', async (ctx) => {
  if (!config.ownerId || ctx.from.id !== config.ownerId) return;
  deletePerson(ctx.from.id);
  return ctx.reply('Твій запис у боті стерто. Можна тестувати з початку.');
});

bot.command('start', async (ctx) => {
  if (ctx.chat.type !== 'private') return;
  const person = upsertPerson(ctx.from);

  if (STARTED.has(person.status)) return replyRepeatStart(ctx, person);

  const ig = resolveStartCode(ctx.match?.trim());
  if (ig) return beginAudit(ctx, ig);

  updatePerson(ctx.from.id, { status: STATUS.AWAITING_NICK });
  return ctx.reply(t(KEYS.greetingNoNick));
});

// Текст від людини, яка ще не дала нік, — це її нік.
bot.on('message:text', async (ctx, next) => {
  if (ctx.chat.type !== 'private' || ctx.message.text.startsWith('/')) return next();
  const person = getPerson(ctx.from.id);
  if (person && person.status !== STATUS.AWAITING_NICK) return next();

  upsertPerson(ctx.from);
  const ig = normalizeIg(ctx.message.text);
  if (!ig) return ctx.reply(t(KEYS.nickInvalid));
  return beginAudit(ctx, ig);
});

bot.catch((err) => {
  const e = err.error;
  if (e instanceof GrammyError) console.error('Помилка Telegram:', e.description);
  else if (e instanceof HttpError) console.error("Немає зв'язку з Telegram:", e);
  else console.error('Помилка в обробнику:', e);
});
