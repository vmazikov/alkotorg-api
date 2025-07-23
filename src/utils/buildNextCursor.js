export function makeNextCursor(lastRow, sort) {
  if (!lastRow) return null;

  switch (sort) {
    case 'name_asc':
      return { name: lastRow.name, id: lastRow.id };

    case 'price_asc':
    case 'price_desc':
      return { basePrice: lastRow.basePrice, id: lastRow.id };
      
    case 'volume_asc':
    case 'volume_desc':
      return { volume: lastRow.volume ?? 0, id: lastRow.id };

    case 'degree_asc':
    case 'degree_desc':
      return { degree: lastRow.degree ?? 0, id: lastRow.id };

    default:                       // без сортировки
      return { id: lastRow.id };
  }
}

export function buildWhereAfter(cursor, sort, Prisma) {
  if (!cursor) return {};

  switch (sort) {
    case 'name_asc':
      return {
        OR: [
          { name: { gt: cursor.name } },
          { name: cursor.name, id: { gt: cursor.id } },
        ],
      };

    case 'price_asc':
      return {
        OR: [
          { basePrice: { gt: cursor.basePrice } },
          { basePrice: cursor.basePrice, id: { gt: cursor.id } },
        ],
      };

    case 'price_desc':
      return {
        OR: [
          { basePrice: { lt: cursor.basePrice } },
          { basePrice: cursor.basePrice, id: { gt: cursor.id } },
        ],
      };

    case 'degree_asc':
      return {
        OR: [
          { degree: { gt: cursor.degree } },
          { degree: cursor.degree, id: { gt: cursor.id } },
        ],
      };

    case 'degree_desc':
      return {
        OR: [
          { degree: { lt: cursor.degree } },
          { degree: cursor.degree, id: { gt: cursor.id } },
        ],
      };

    case 'volume_asc':
      return {
        OR: [
          { volume: { gt: cursor.volume } },
          { volume: cursor.volume, id: { gt: cursor.id } },
        ],
      };

    case 'volume_desc':
      return {
        OR: [
          { volume: { lt: cursor.volume } },
          { volume: cursor.volume, id: { gt: cursor.id } },
        ],
      };


    default:         // без сортировки
      return { id: { gt: cursor.id } };
  }
}
