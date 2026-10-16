// Перевірка без запуску бота: чи всі тексти на місці і чи збирається промпт.
// Запуск: npm run check
import { t, KEYS, missingKeys } from './texts.js';
import { buildSystemPrompt } from './prompt.js';

let ok = true;

if (missingKeys.length) {
  ok = false;
  console.log('✗ Немає текстів:', missingKeys.join(', '));
} else {
  console.log(`✓ Тексти: усі ${Object.keys(KEYS).length} розділів знайдено`);
}

const prompt = buildSystemPrompt();
if (prompt.includes('{{ПРИКЛАД_АУДИТУ}}') || !prompt.includes('Повідомлення 1')) {
  ok = false;
  console.log('✗ Приклад аудиту не вставився в промпт');
} else {
  console.log(`✓ Промпт зібрано: ${prompt.length} символів`);
}

console.log('\nПриклад тексту:\n' + t(KEYS.ownerDiagnostics, { name: 'Олена', tg: 'olena_tg', ig: 'olena.ig' }));
process.exit(ok ? 0 : 1);
