// Дотиски після аудиту:
// 1) не натиснули «Діагностика» → нагадування через REMIND_AFTER_HOURS після аудиту,
//    ще через CHANNEL_AFTER_REMINDER_HOURS — запрошення в канал;
// 2) натиснули «Діагностика» → через CHANNEL_AFTER_DIAG_HOURS запрошення в канал (незалежно від зустрічі),
//    а через ASK_OWNER_AFTER_HOURS (тиждень) бот питає Ольгу, чи людина прийшла.
//    «Не прийшла» → людині нагадування, що можливість ще діє, з кнопкою «Діагностика».
// Людям нічого не надсилається в тихі години (QUIET_FROM–QUIET_TO).
import { GrammyError } from 'grammy';
import { config } from './config.js';
import {
  NOSHOW, getPerson, updatePerson,
  dueReminders, dueNoshowReminders, dueChannelInvites, dueOwnerQuestions,
} from './db.js';
import { isQuiet } from './schedule.js';
import { formatKyiv, syncRow } from './sheets.js';
import { t, KEYS } from './texts.js';
import { getApi, diagnosticsKeyboard, notifyOwner } from './notify.js';

const HOUR = 60 * 60_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function addLog(person, what) {
  const date = formatKyiv(Date.now()).split(' ')[0];
  return [person.followups, `${what} ${date}`].filter(Boolean).join('; ');
}

async function sendToPerson(person, text, extra, fields, what) {
  try {
    await getApi().sendMessage(person.tg_id, text, extra);
  } catch (e) {
    // Людина заблокувала бота — позначаємо як зроблене, щоб не пробувати без кінця.
    if (!(e instanceof GrammyError && (e.error_code === 403 || e.error_code === 400))) throw e;
    console.warn(`Дотиск для @${person.ig} не доставлено:`, e.description);
    what += ' (не доставлено)';
  }
  updatePerson(person.tg_id, { ...fields, followups: addLog(person, what) });
  console.log(`Дотиск для @${person.ig}: ${what}`);
  await sleep(500);
}

const channelKeyboard = () => ({
  inline_keyboard: [[{ text: t(KEYS.channelButton), url: config.channelUrl }]],
});

const ownerQuestionKeyboard = (tgId) => ({
  inline_keyboard: [[
    { text: t(KEYS.ownerCameButton), callback_data: `came:${tgId}` },
    { text: t(KEYS.ownerNoshowButton), callback_data: `noshow:${tgId}` },
  ]],
});

async function processDue() {
  // Питання Ользі — у будь-який час, крім ночі (щоб не будити).
  if (isQuiet(Date.now())) return;

  for (const p of dueOwnerQuestions(config.askOwnerAfterHours * HOUR)) {
    const msg = await notifyOwner(p, KEYS.ownerAskCame, {}, { reply_markup: ownerQuestionKeyboard(p.tg_id) });
    if (msg) {
      updatePerson(p.tg_id, { asked_at: Date.now() });
      console.log(`Запитала Ольгу, чи @${p.ig} прийшла на діагностику`);
    }
  }

  for (const p of dueReminders(config.remindAfterHours * HOUR)) {
    await sendToPerson(p, t(KEYS.reminderNoDiag), { reply_markup: diagnosticsKeyboard() },
      { reminder_at: Date.now() }, 'нагадування про діагностику');
  }

  for (const p of dueNoshowReminders()) {
    await sendToPerson(p, t(KEYS.reminderNoshow), { reply_markup: diagnosticsKeyboard() },
      { noshow: NOSHOW.REMINDED }, 'нагадування після неявки');
  }

  if (config.channelUrl) {
    const invites = dueChannelInvites(config.channelAfterReminderHours * HOUR, config.channelAfterDiagHours * HOUR);
    for (const p of invites) {
      await sendToPerson(p, t(KEYS.channelInvite), { reply_markup: channelKeyboard() },
        { channel_at: Date.now() }, 'запрошення в канал');
    }
  }
}

// Ольга відповіла на питання «Прийшла?» кнопкою. Повертає текст для оновлення її повідомлення.
export function handleOwnerAnswer(tgId, came) {
  const p = getPerson(tgId);
  if (!p) return null;
  if (came) {
    updatePerson(tgId, { noshow: NOSHOW.NONE });
    syncRow(p, { status: 'була на діагностиці' });
    return t(KEYS.ownerMarkedCame);
  }
  if (p.noshow === NOSHOW.NONE) updatePerson(tgId, { noshow: NOSHOW.FLAGGED });
  syncRow(p, { status: 'не прийшла на діагностику' });
  setTimeout(tick, 1000);
  return t(KEYS.ownerMarkedNoshow);
}

let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    await processDue();
  } catch (e) {
    console.error('Помилка дотисків:', e);
  } finally {
    running = false;
  }
}

export function startFollowups() {
  if (!config.channelUrl) console.warn('Увага: не задано CHANNEL_URL — запрошення в канал не надсилатимуться');
  setInterval(tick, 5 * 60_000);
  setTimeout(tick, 20_000);
}

export const _test = { processDue };
