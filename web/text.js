// Sentences shared by the page and the report.

export function fmt(v, unit = '', digits = 1) {
  if (!Number.isFinite(v)) return '–';
  const n = v.toFixed(digits);
  return `${n === '-0' || n === '-0.0' ? n.slice(1) : n}${unit}`;
}

function signedMm(v) {
  const r = Math.round(v);
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r)} mm`;
}

export function verdictSentence(c) {
  if (!c) return 'No published range we could check for this measure, so no verdict.';
  const where = c.verdict === 'within' ? 'Within' : c.verdict === 'below' ? 'Below' : 'Above';
  return `${where} the published range of ${fmt(c.low, '°', 0)} to ${fmt(c.high, '°', 0)} (${c.kind} measurement, ${c.source.short}).`;
}

export function saddleSentence(saddle, crankGiven = true) {
  if (!crankGiven) return 'Give your crank length to get the saddle change in millimetres.';
  if (!saddle) return 'No saddle change is computed without a published range to aim for.';
  const lo = Math.min(saddle.toLow, saddle.toHigh), hi = Math.max(saddle.toLow, saddle.toHigh);
  const marks = saddle.notchMm
    ? ` (about ${fmt(Math.abs(saddle.toMiddle / saddle.notchMm), '', 1)} of your ${fmt(saddle.notchMm, ' mm', 0)} marks)`
    : '';
  const inside = lo <= 0 && hi >= 0;
  const move = Math.round(saddle.toMiddle) === 0
    ? 'Your saddle height already puts this angle in the middle of that range.'
    : `Moving the saddle ${saddle.toMiddle > 0 ? 'up' : 'down'} by about ${Math.abs(Math.round(saddle.toMiddle))} mm would put this angle in the middle of that range${marks}.`;
  const span = inside
    ? ` You are inside it now; any change between ${signedMm(lo)} and ${signedMm(hi)} keeps you inside.`
    : ` Any change between ${signedMm(lo)} and ${signedMm(hi)} lands inside it.`;
  return `${move}${span} This is geometry, not a prescription: the ankle often changes too when the saddle moves, so make one small change at a time and see how it feels.`;
}
