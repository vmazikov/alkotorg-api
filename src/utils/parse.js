// utils/parse.js  (добавь куда-нибудь в helpers, чтобы не дублировать)
export function toFloat(v) {
  if (v === undefined || v === null || v === '') return null;
  // Excel иногда приходит как число (1) или строка ("0,7")
  const num = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(num) ? num : null;
}

export function toInt(v) {
  if (v === undefined || v === null || v === '') return null;
  const num = parseInt(v, 10);
  return Number.isFinite(num) ? num : null;
}
