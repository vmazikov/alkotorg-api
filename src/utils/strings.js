export function normalizeName(raw = '') {
  let s = String(raw || '').toLowerCase().trim();
  // единые пробелы
  s = s.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');
  // прибираем типичные «хвосты» упаковок в конце: "x12", "×12", "12 шт", "(12 шт)"
  s = s.replace(/[\s,]*\(?\s*(x|×)?\s*\d+\s*(шт|штук|pcs)?\s*\)?\s*$/i, '');
  // добивка: убрать финальные знаки препинания/пробелы
  s = s.replace(/[,\.;:]\s*$/,'').trim();
  return s;
}
