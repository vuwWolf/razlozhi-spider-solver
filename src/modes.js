/**
 * Сколько колод подряд нужно разыграть.
 *
 * Фиксированная колода (`--deck`), сухой прогон и ежедневная игра всегда
 * делают одну попытку: `--games` на них не влияет. В остальных режимах
 * перебирается до `games` разных колод.
 */
export function plannedGames({ mode, deck = null, daily = false, dryRun = false, games = 1 } = {}) {
  if (deck || daily || dryRun || mode === 'deck' || mode === 'daily') return 1;
  return Math.max(1, Number(games) || 1);
}
