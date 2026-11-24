/**
 * Формирование текстового отчёта с найденными ходами.
 *
 * Ходы нумеруются и описываются в том порядке, в котором их нужно выполнить.
 * Для описания каждого хода используется состояние *до* этого хода — так же,
 * как это делает `--dry-run` в CLI.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { applyMove, describeMove } from './model.js';

/**
 * Возвращает текст отчёта.
 *
 * @param {object} options
 * @param {Array} options.moves — найденные ходы;
 * @param {object} options.state — начальное состояние, с которого они применяются;
 * @param {string|null} [options.deckCode] — код колоды, если известен;
 * @param {number|null} [options.attempt] — номер попытки поиска;
 * @param {string} [options.title] — заголовок отчёта;
 * @param {Date} [options.date] — время отчёта (по умолчанию сейчас).
 */
export function formatMoveLog({
  moves,
  state,
  deckCode = null,
  attempt = null,
  title = 'Решение пасьянса «Паук (две масти)»',
  date = new Date(),
}) {
  const lines = [
    title,
    `Дата: ${date.toISOString()}`,
  ];
  if (deckCode) lines.push(`Колода: ${deckCode}`);
  if (attempt !== null && attempt !== undefined) lines.push(`Попытка поиска: ${attempt}`);
  lines.push(`Ходов: ${moves.length}`, '');

  let current = state;
  for (const [index, move] of moves.entries()) {
    lines.push(`${String(index + 1).padStart(3, ' ')}. ${describeMove(move, current)}`);
    current = applyMove(current, move);
  }
  lines.push('');

  return lines.join('\n');
}

/**
 * Записывает отчёт в файл в UTF-8, создавая при необходимости каталоги.
 *
 * @returns {Promise<{path: string, moves: number}>}
 */
export async function writeMoveLog(path, options) {
  const parent = dirname(path);
  if (parent && parent !== '.') await mkdir(parent, { recursive: true });

  const text = formatMoveLog(options);
  await writeFile(path, text, 'utf8');
  return { path, moves: options.moves.length };
}
