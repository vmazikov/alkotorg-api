// этот файл импортируется и в Node, и в Vite
export function resolveStatus(rules, stockRaw, priceRaw) {
  const stock = +stockRaw || 0;
  const price = +priceRaw || 0;

  for (const r of rules) {
    const priceOK = r.priceMax == null || price < r.priceMax;
    const stockOK = r.stockMax == null || stock <= r.stockMax;
    if (priceOK && stockOK) return { label: r.label, color: r.color };
  }
  // если правил нет
  return { label: 'Достаточно', color: 'bg-yellow-500' };
}
