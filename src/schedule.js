// Час надсилання аудиту: через DELAY_MIN–DELAY_MAX хвилин після старту,
// а якщо це припадає на тихі години (QUIET_FROM–QUIET_TO за Києвом) — зранку о QUIET_TO:00–:59.
import { config } from './config.js';

const MIN = 60_000;
const rand = (a, b) => a + Math.random() * Math.max(0, b - a);

function localHourMinute(ms) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: config.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return { hour: get('hour'), minute: get('minute') };
}

export function isQuiet(ms) {
  const { quietFrom: from, quietTo: to } = config;
  if (from === to) return false; // тихі години вимкнено
  const { hour } = localHourMinute(ms);
  return from > to ? hour >= from || hour < to : hour >= from && hour < to;
}

export function computeSendAt(startedAt, nowMs = Date.now()) {
  let t = Math.max(nowMs, startedAt + rand(config.delayMin, config.delayMax) * MIN);
  if (!isQuiet(t)) return Math.round(t);

  // Шукаємо найближчий початок години QUIET_TO за Києвом (крок 1 хвилина, максимум доба).
  for (let i = 0; i < 24 * 60 && isQuiet(t); i++) t += MIN;
  const { minute } = localHourMinute(t);
  t -= minute * MIN; // рівно QUIET_TO:00
  return Math.round(t + rand(0, 59) * MIN);
}
