// Збирає системний промпт: prompts/audit.md + приклад аудиту з materials/.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PROMPT_FILE = fileURLToPath(new URL('../prompts/audit.md', import.meta.url));
const EXAMPLE_FILE = fileURLToPath(new URL('../materials/приклад-аудиту.md', import.meta.url));
const PLACEHOLDER = '{{ПРИКЛАД_АУДИТУ}}';

export function buildSystemPrompt() {
  const prompt = readFileSync(PROMPT_FILE, 'utf8');
  // Службову шапку файлу-прикладу (заголовок і примітку «Джерело») моделі не передаємо.
  const example = readFileSync(EXAMPLE_FILE, 'utf8')
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('# ') && !line.startsWith('> '))
    .join('\n')
    .trim();
  if (!prompt.includes(PLACEHOLDER)) {
    console.warn(`У prompts/audit.md немає ${PLACEHOLDER} — приклад аудиту не буде вставлено.`);
  }
  return prompt.replace(PLACEHOLDER, example);
}
