// Налаштування бота. Значення беруться з Railway → Variables (або з файлу .env при локальному запуску).
import 'dotenv/config';

const env = process.env;

function num(name, fallback) {
  const v = Number(env[name]);
  return Number.isFinite(v) && env[name] !== '' && env[name] !== undefined ? v : fallback;
}

export const config = {
  botToken: env.BOT_TOKEN?.trim(),
  anthropicKey: env.ANTHROPIC_API_KEY?.trim(),
  apifyToken: env.APIFY_TOKEN?.trim(),
  sheetsUrl: env.SHEETS_WEBHOOK_URL?.trim(),
  sheetsSecret: env.SHEETS_SECRET?.trim(),
  ownerId: env.OWNER_TELEGRAM_ID ? Number(env.OWNER_TELEGRAM_ID) : null,
  publicUrl: env.PUBLIC_URL?.trim().replace(/\/+$/, ''),
  botUsername: env.BOT_USERNAME?.trim().replace(/^@/, ''),

  claudeModel: env.CLAUDE_MODEL?.trim() || 'claude-sonnet-5-5',
  delayMin: num('DELAY_MIN_MINUTES', 120),
  delayMax: num('DELAY_MAX_MINUTES', 180),
  quietFrom: num('QUIET_FROM', 22),
  quietTo: num('QUIET_TO', 9),
  timezone: env.TIMEZONE?.trim() || 'Europe/Kiev',
  dbPath: env.DB_PATH?.trim() || './data/bot.db',

  port: num('PORT', 3000),
};

// Без токена бот не може працювати взагалі — зупиняємось із зрозумілим повідомленням.
export function requireBotToken() {
  if (!config.botToken) {
    console.error('Немає BOT_TOKEN. Додай його в Railway → Variables.');
    process.exit(1);
  }
}
