// Скрипт для Google-таблиці бота «Аудит Instagram».
// Вставляється в таблиці: Розширення → Apps Script. Інструкція — у повідомленні Claude.
//
// ЄДИНЕ, що треба змінити: впиши між лапками те саме слово-пароль, що й у Railway → SHEETS_SECRET.
const SECRET = 'ВПИШИ_СЮДИ_ПАРОЛЬ';

const SHEET_NAME = 'Аудити';
const HEADERS = ['Дата і час', 'Instagram', "Ім'я Telegram", 'Нік Telegram', 'Статус', 'Аналіз для Ольги', 'Текст аудиту'];
// Яке поле з бота в яку колонку (номер колонки, починаючи з 1)
const COLUMNS = { date: 1, ig: 2, name: 3, tg: 4, status: 5, analysis: 6, text: 7 };

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.secret !== SECRET) return reply({ ok: false, error: 'wrong secret' });
    if (!data.ig) return reply({ ok: false, error: 'no ig' });

    const sheet = getSheet();
    const ig = String(data.ig).toLowerCase();
    const lastRow = sheet.getLastRow();
    let row = 0;
    if (lastRow > 1) {
      const nicks = sheet.getRange(2, COLUMNS.ig, lastRow - 1, 1).getValues();
      for (let i = 0; i < nicks.length; i++) {
        if (String(nicks[i][0]).toLowerCase() === ig) {
          row = i + 2;
          break;
        }
      }
    }

    if (!row) {
      row = lastRow + 1;
      sheet.getRange(row, COLUMNS.date).setValue(data.date || new Date());
    }
    for (const key of ['ig', 'name', 'tg', 'status', 'analysis', 'text']) {
      if (data[key] !== undefined && data[key] !== null) {
        let value = String(data[key]);
        if (/^[=+]/.test(value)) value = "'" + value; // щоб таблиця не прийняла текст за формулу
        sheet.getRange(row, COLUMNS[key]).setValue(value);
      }
    }
    return reply({ ok: true, row: row });
  } catch (err) {
    return reply({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// Відкрий адресу скрипта в браузері: якщо бачиш «ok», скрипт опубліковано правильно.
function doGet() {
  return reply({ ok: true });
}

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  }
  return sheet;
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
