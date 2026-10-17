// Робочий цикл: робить аудити (Apify → Claude) і надсилає готові за розкладом.
// Усе зберігається в базі, тож після перезапуску бота робота продовжується з того самого місця.
import { GrammyError } from 'grammy';
import { config } from './config.js';
import { STATUS, nextAuditDue, nextSendDue, updatePerson } from './db.js';
import { fetchProfile, downloadImage, PageUnreadableError } from './apify.js';
import {
  buildProfileContent, buildScreenshotsContent, generateAudit, toTelegramHtml, toPlainText,
} from './claude.js';
import { computeSendAt } from './schedule.js';
import { syncRow, formatKyiv } from './sheets.js';
import { t, KEYS } from './texts.js';
import { getApi, notifyAuditFailed, doneKeyboard, diagnosticsKeyboard } from './notify.js';

const MIN = 60_000;
const MAX_ATTEMPTS = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Два незалежні цикли: довга генерація аудиту не затримує надсилання готових, і навпаки.
function makeLoop(name, nextDue, handle) {
  let running = false;
  let again = false;
  return async function tick() {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        let p;
        while ((p = nextDue())) await handle(p);
      } while (again);
    } catch (e) {
      console.error(`Помилка циклу «${name}»:`, e);
    } finally {
      running = false;
    }
  };
}

const auditTick = makeLoop('аудит', nextAuditDue, (p) => runAudit(p));
const sendTick = makeLoop('надсилання', nextSendDue, (p) => sendAudit(p));

// Викликається, коли з'явилась нова робота (нік, «Готово»): не чекаємо наступної перевірки.
export function startAudit() {
  auditTick();
}

export function startWorker() {
  setInterval(() => {
    auditTick();
    sendTick();
  }, 30_000);
  auditTick();
  sendTick();
}

async function telegramImage(fileId) {
  try {
    const file = await getApi().getFile(fileId);
    return await downloadImage(`https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`);
  } catch (e) {
    console.error('Не вдалося завантажити скріншот:', e.message);
    return null;
  }
}

async function runAudit(person) {
  const tg = person.tg_id;
  const screenshots = JSON.parse(person.screenshots || '[]');
  console.log(`Роблю аудит для @${person.ig} (${screenshots.length ? 'за скріншотами' : 'через Apify'}), спроба ${person.attempts + 1}`);

  try {
    let content;
    if (screenshots.length) {
      const images = (await Promise.all(screenshots.map(telegramImage))).filter(Boolean);
      if (!images.length) throw new Error('Не вдалося завантажити жодного скріншоту');
      content = buildScreenshotsContent(person.ig, images);
    } else {
      const profile = await fetchProfile(person.ig);
      const posts = profile.latestPosts.slice(0, 12);
      const covers = await Promise.all(posts.map((p) => downloadImage(p.displayUrl)));
      console.log(`@${person.ig}: ${posts.length} публікацій, обкладинок завантажено ${covers.filter(Boolean).length}`);
      content = buildProfileContent(profile, covers);
    }

    // Якщо минула спроба обірвалась на ліміті довжини — просимо Claude думати коротше.
    const truncatedBefore = (person.last_error || '').includes('max_tokens');
    const { analysis, messages } = await generateAudit(content, truncatedBefore ? { effort: 'medium' } : {});
    const sendAt = computeSendAt(person.started_at || person.created_at);
    const updated = updatePerson(tg, {
      status: STATUS.READY,
      analysis,
      messages: JSON.stringify(messages),
      send_at: sendAt,
      sent_parts: 0,
      last_error: null,
    });
    console.log(`Аудит для @${person.ig} готовий (${messages.length} повідомл.), надсилання ${formatKyiv(sendAt)}`);
    syncRow(updated, { analysis: toPlainText(analysis), text: messages.map(toPlainText).join('\n\n———\n\n') });
    if (sendAt <= Date.now()) sendTick();
  } catch (e) {
    if (e instanceof PageUnreadableError) {
      console.log(e.message, '— прошу скріншоти');
      const updated = updatePerson(tg, { status: STATUS.AWAITING_SCREENS, screenshots: '[]' });
      await getApi()
        .sendMessage(tg, t(KEYS.pageUnreadable, { ig: person.ig }), { reply_markup: doneKeyboard() })
        .catch((err) => console.error('Не вдалося попросити скріншоти:', err.message));
      syncRow(updated);
      return;
    }

    const attempts = person.attempts + 1;
    const lastError = String(e.message || e).slice(0, 300);
    console.error(`Аудит для @${person.ig} не вдався (спроба ${attempts}):`, e.message);
    if (attempts >= MAX_ATTEMPTS) {
      const updated = updatePerson(tg, { status: STATUS.ERROR, attempts, last_error: lastError });
      syncRow(updated);
      await notifyAuditFailed(updated);
    } else {
      // Обрізану відповідь повторюємо одразу (з коротшими роздумами), інші збої — через 5 і 10 хв.
      const delay = lastError.includes('max_tokens') ? 0 : attempts * 5 * MIN;
      updatePerson(tg, { attempts, last_error: lastError, next_try_at: Date.now() + delay });
      if (!delay) setTimeout(startAudit, 1000);
    }
  }
}

// Надсилає з жирним шрифтом; якщо Telegram не прийняв розмітку — надсилає той самий текст без неї.
async function sendFormatted(chatId, text, extra) {
  try {
    return await getApi().sendMessage(chatId, toTelegramHtml(text), { parse_mode: 'HTML', ...extra });
  } catch (e) {
    if (e instanceof GrammyError && e.error_code === 400 && /parse|entit/i.test(e.description)) {
      console.warn('Telegram не прийняв розмітку, надсилаю без неї:', e.description);
      return getApi().sendMessage(chatId, toPlainText(text), extra);
    }
    throw e;
  }
}

async function sendAudit(person) {
  const tg = person.tg_id;
  const messages = JSON.parse(person.messages || '[]');
  try {
    for (let i = person.sent_parts || 0; i < messages.length; i++) {
      const last = i === messages.length - 1;
      // Перше повідомлення починається із заголовка з texts/messages.md («ТВІЙ АУДИТ ГОТОВИЙ»).
      const text = i === 0 ? `${t(KEYS.auditHeader, { ig: person.ig })}\n\n${messages[i]}` : messages[i];
      await sendFormatted(tg, text, last ? { reply_markup: diagnosticsKeyboard() } : {});
      updatePerson(tg, { sent_parts: i + 1 });
      if (!last) await sleep(2000);
    }
    const updated = updatePerson(tg, { status: STATUS.SENT, sent_at: Date.now() });
    console.log(`Аудит надіслано @${person.ig}`);
    syncRow(updated);
  } catch (e) {
    // 403/400: людина заблокувала бота або чату не існує — повтор не допоможе.
    if (e instanceof GrammyError && (e.error_code === 403 || e.error_code === 400)) {
      console.error(`Не вдалося надіслати аудит @${person.ig}:`, e.description);
      const updated = updatePerson(tg, { status: STATUS.ERROR, last_error: `Telegram: ${e.description}` });
      syncRow(updated);
      await notifyAuditFailed(updated);
    } else {
      console.error(`Збій надсилання аудиту @${person.ig}, повтор за 5 хв:`, e.message);
      updatePerson(tg, { send_at: Date.now() + 5 * MIN });
    }
  }
}
