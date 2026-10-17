// Логіка Telegram-бота.
import { Bot, GrammyError, HttpError } from 'grammy';
import { config } from './config.js';
import { t, KEYS } from './texts.js';
import {
  STATUS, NOSHOW, getPerson, upsertPerson, updatePerson, deletePerson,
  resolveStartCode, personByOwnerMessage, rememberOwnerMessage, getPersonByIg,
} from './db.js';
import { normalizeIg } from './nick.js';
import { syncRow } from './sheets.js';
import { startAudit } from './audit.js';
import { handleOwnerAnswer } from './followups.js';
import { setApi, notifyOwner, doneKeyboard, shareContactKeyboard } from './notify.js';

export const bot = new Bot(config.botToken);
setApi(bot.api);

const MAX_SCREENSHOTS = 10;
const isOwner = (ctx) => config.ownerId && ctx.from?.id === config.ownerId;

// Аудит уже розпочато для цієї людини (повторний «Старт» не запускає новий).
const STARTED = new Set([
  STATUS.IN_WORK, STATUS.AWAITING_SCREENS, STATUS.READY,
  STATUS.SENT, STATUS.DIAGNOSTICS, STATUS.ERROR,
]);

async function beginAudit(ctx, ig) {
  const person = updatePerson(ctx.from.id, {
    ig,
    status: STATUS.IN_WORK,
    screenshots: '[]',
    attempts: 0,
    started_at: Date.now(),
    next_try_at: Date.now(),
  });
  await ctx.reply(t(KEYS.greetingWithNick, { ig }));
  syncRow(person);
  startAudit();
}

async function replyRepeatStart(ctx, person) {
  if (person.status === STATUS.SENT || person.status === STATUS.DIAGNOSTICS) {
    return ctx.reply(t(KEYS.repeatSent));
  }
  if (person.status === STATUS.AWAITING_SCREENS) {
    return ctx.reply(t(KEYS.pageUnreadable, { ig: person.ig }), { reply_markup: doneKeyboard() });
  }
  return ctx.reply(t(KEYS.repeatInWork));
}

// ---------- Команди ----------

// /id — службова команда: показує Telegram ID.
bot.command('id', (ctx) =>
  ctx.reply(`Твій Telegram ID: ${ctx.from.id}\n\nСкопіюй це число в Railway → Variables → OWNER_TELEGRAM_ID.`),
);

// /reset — лише для Ольги і тестових акаунтів (TESTER_TELEGRAM_IDS):
// стирає власний запис, щоб пройти шлях від початку під час тестів.
bot.command('reset', async (ctx) => {
  if (!isOwner(ctx) && !config.testerIds.includes(ctx.from.id)) return;
  deletePerson(ctx.from.id);
  return ctx.reply('Твій запис у боті стерто. Можна тестувати з початку.');
});

// /retry нік — лише для Ольги: запускає аудит для людини заново (після помилки чи щоб переробити).
bot.command('retry', async (ctx) => {
  if (!isOwner(ctx)) return;
  const ig = normalizeIg(ctx.match || '');
  if (!ig) return ctx.reply('Напиши нік після команди, наприклад: /retry olhamakarchuk');
  const person = getPersonByIg(ig);
  if (!person) return ctx.reply(`Не знайшла в боті людини з ніком @${ig}.`);
  const updated = updatePerson(person.tg_id, {
    status: STATUS.IN_WORK, attempts: 0, last_error: null, next_try_at: Date.now(), sent_parts: 0,
  });
  syncRow(updated);
  startAudit();
  return ctx.reply(`Запустила аудит для @${ig} заново. Він прийде людині за звичайним розкладом.`);
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

// ---------- Кнопки ----------

bot.callbackQuery('screens_done', async (ctx) => {
  const person = getPerson(ctx.from.id);
  if (!person || person.status !== STATUS.AWAITING_SCREENS) return ctx.answerCallbackQuery();
  const screenshots = JSON.parse(person.screenshots || '[]');
  if (!screenshots.length) {
    return ctx.answerCallbackQuery({ text: t(KEYS.noScreenshotsYet), show_alert: true });
  }
  await ctx.answerCallbackQuery();
  const updated = updatePerson(person.tg_id, { status: STATUS.IN_WORK, attempts: 0, next_try_at: Date.now() });
  await ctx.reply(t(KEYS.screenshotsReceived));
  syncRow(updated);
  startAudit();
});

bot.callbackQuery('diag', async (ctx) => {
  await ctx.answerCallbackQuery();
  const person = getPerson(ctx.from.id) || upsertPerson(ctx.from);
  const hasNick = Boolean(person.tg_username);
  // Повторна заявка — після того, як Ольга позначила неявку і бот запропонував інший час.
  const rebooking = person.status === STATUS.DIAGNOSTICS && person.noshow === NOSHOW.REMINDED;
  if (person.status !== STATUS.DIAGNOSTICS || rebooking) {
    const updated = updatePerson(person.tg_id, {
      status: STATUS.DIAGNOSTICS,
      // Після повторної заявки цикл починається заново: через тиждень бот знову запитає Ольгу.
      diag_at: Date.now(),
      asked_at: null,
      noshow: NOSHOW.NONE,
    });
    syncRow(updated);
    const extra = hasNick
      ? {
          reply_markup: {
            inline_keyboard: [[{ text: t(KEYS.ownerChatButton), url: `https://t.me/${updated.tg_username}` }]],
          },
        }
      : {};
    await notifyOwner(
      updated,
      rebooking ? KEYS.ownerRebooking : KEYS.ownerDiagnostics,
      {},
      extra,
      hasNick ? null : KEYS.ownerNoTgNick,
    );
  }
  // Без ніка в Telegram просимо поділитися номером (кнопка внизу екрана).
  if (hasNick) return ctx.reply(t(KEYS.afterDiagnostics));
  return ctx.reply(t(KEYS.afterDiagnosticsNoNick), { reply_markup: shareContactKeyboard() });
});

// Ольга відповідає на питання бота «Чи прийшла людина на діагностику?»
bot.callbackQuery(/^(came|noshow):(\d+)$/, async (ctx) => {
  if (!isOwner(ctx)) return ctx.answerCallbackQuery();
  const [, answer, tgId] = ctx.match;
  const note = handleOwnerAnswer(Number(tgId), answer === 'came');
  await ctx.answerCallbackQuery({ text: note || 'Людину не знайдено' });
  if (!note) return;
  // Прибираємо кнопки і дописуємо відповідь під питанням.
  const original = ctx.callbackQuery.message;
  await ctx
    .editMessageText(`${original.text}\n\n${note}`, { entities: original.entities, link_preview_options: { is_disabled: true } })
    .catch(() => ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {}));
});

// ---------- Повідомлення ----------

// Ольга відповідає через Reply на переслане повідомлення → бот надсилає її відповідь людині.
bot.on('message', async (ctx, next) => {
  const replyTo = ctx.message.reply_to_message;
  if (!isOwner(ctx) || !replyTo) return next();
  const person = personByOwnerMessage(replyTo.message_id);
  if (!person) return next();
  try {
    await ctx.api.copyMessage(person.tg_id, ctx.chat.id, ctx.message.message_id);
    await ctx.reply('✓ Надіслано', { reply_parameters: { message_id: ctx.message.message_id } });
  } catch (e) {
    await ctx.reply(`Не вдалося надіслати: ${e.description || e.message}`);
  }
});

// Людина поділилась своїм номером через кнопку «Поділитися номером».
bot.on('message:contact', async (ctx, next) => {
  const contact = ctx.message.contact;
  const person = getPerson(ctx.from.id);
  if (ctx.chat.type !== 'private' || !person || contact.user_id !== ctx.from.id) return next();
  const phone = contact.phone_number.startsWith('+') ? contact.phone_number : `+${contact.phone_number}`;
  updatePerson(person.tg_id, { phone });
  await ctx.reply(t(KEYS.contactReceived), { reply_markup: { remove_keyboard: true } });
  await notifyOwner(person, KEYS.ownerPhone, { phone });
});

bot.on('message', async (ctx, next) => {
  if (ctx.chat.type !== 'private') return;
  const m = ctx.message;
  if (m.text?.startsWith('/')) return; // невідомі команди ігноруємо

  let person = getPerson(ctx.from.id);
  if (!person || person.status === STATUS.AWAITING_NICK) {
    person = upsertPerson(ctx.from);
    if (!m.text) return ctx.reply(t(KEYS.greetingNoNick));
    const ig = normalizeIg(m.text);
    if (!ig) return ctx.reply(t(KEYS.nickInvalid));
    return beginAudit(ctx, ig);
  }

  person = upsertPerson(ctx.from); // оновлюємо ім'я й нік Telegram, якщо змінилися

  if (person.status === STATUS.AWAITING_SCREENS) {
    const fileId = imageFileId(m);
    if (fileId) {
      const screenshots = JSON.parse(person.screenshots || '[]');
      if (screenshots.length < MAX_SCREENSHOTS) {
        screenshots.push(fileId);
        updatePerson(person.tg_id, { screenshots: JSON.stringify(screenshots) });
      }
      return;
    }
    if (m.text && looksLikeNick(m.text)) return beginAudit(ctx, normalizeIg(m.text));
  }

  return forwardToOwner(ctx, person);
});

function imageFileId(m) {
  if (m.photo?.length) return m.photo[m.photo.length - 1].file_id; // найбільший розмір
  if (m.document?.mime_type?.startsWith('image/')) return m.document.file_id;
  return null;
}

function looksLikeNick(text) {
  const ig = normalizeIg(text);
  return Boolean(ig) && (text.includes('@') || /instagram\.com/i.test(text) || ig.length >= 3);
}

function messageLabel(m) {
  if (m.text) return m.text;
  const caption = m.caption ? `: ${m.caption}` : '';
  if (m.photo) return `[фото]${caption}`;
  if (m.video) return `[відео]${caption}`;
  if (m.voice) return '[голосове]';
  if (m.video_note) return '[відеокружечок]';
  if (m.sticker) return `[стікер ${m.sticker.emoji || ''}]`.replace(' ]', ']');
  if (m.document) return `[файл]${caption}`;
  if (m.audio) return `[аудіо]${caption}`;
  return '[повідомлення]';
}

// Захист від спаму: не більше 30 пересилань на годину від однієї людини,
// і автовідповідь не частіше ніж раз на 10 хвилин.
const limits = new Map();
function allow(tgId) {
  const nowMs = Date.now();
  const s = limits.get(tgId) || { windowStart: nowMs, count: 0, lastReply: 0 };
  if (nowMs - s.windowStart > 60 * 60_000) Object.assign(s, { windowStart: nowMs, count: 0 });
  s.count++;
  limits.set(tgId, s);
  const forward = s.count <= 30;
  const reply = nowMs - s.lastReply > 10 * 60_000;
  if (reply) s.lastReply = nowMs;
  return { forward, reply };
}

async function forwardToOwner(ctx, person) {
  const m = ctx.message;
  const { forward, reply } = allow(person.tg_id);
  if (forward) {
    await notifyOwner(person, KEYS.ownerForwarded, { text: messageLabel(m) });
    if (!m.text && config.ownerId) {
      try {
        const copied = await ctx.api.copyMessage(config.ownerId, ctx.chat.id, m.message_id);
        rememberOwnerMessage(copied.message_id, person.tg_id);
      } catch (e) {
        console.error('Не вдалося переслати вкладення Ользі:', e.message);
      }
    }
  }
  if (reply) await ctx.reply(t(KEYS.freeTextReply));
}

bot.catch((err) => {
  const e = err.error;
  if (e instanceof GrammyError) console.error('Помилка Telegram:', e.description);
  else if (e instanceof HttpError) console.error("Немає зв'язку з Telegram:", e);
  else console.error('Помилка в обробнику:', e);
});
