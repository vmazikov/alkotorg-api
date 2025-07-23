// utils/buildCursor.js
export default function buildCursor(prod, sort) {
  if (!sort) return { id: prod.id };

  const map = {
    name_asc:    { name: prod.name,         id: prod.id },
    price_asc:   { basePrice: prod.basePrice, id: prod.id },
    price_desc:  { basePrice: prod.basePrice, id: prod.id },
    volume_asc:  { volume:    prod.volume ?? 0, id: prod.id },
    volume_desc: { volume:    prod.volume ?? 0, id: prod.id },
    degree_asc:  { degree:    prod.degree ?? 0, id: prod.id },
    degree_desc: { degree:    prod.degree ?? 0, id: prod.id },
  };
  return map[sort] ?? { id: prod.id };
}
