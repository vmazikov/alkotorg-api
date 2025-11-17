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
      return { volume: lastRow.volume ?? null, id: lastRow.id };

    case 'degree_asc':
    case 'degree_desc':
      return { degree: lastRow.degree ?? null, id: lastRow.id };

    case 'popular':
      return {
        manualScore: lastRow.score?.manualScore ?? null,
        score: lastRow.score?.score ?? null,
        id: lastRow.id,
      };

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

    case 'degree_asc': {
      if (cursor.degree == null) {
        return {
          OR: [
            { degree: null, id: { gt: cursor.id } },
            { degree: { not: null } },
          ],
        };
      }
      return {
        OR: [
          { degree: { gt: cursor.degree } },
          { degree: cursor.degree, id: { gt: cursor.id } },
        ],
      };
    }

    case 'degree_desc': {
      if (cursor.degree == null) {
        return {
          AND: [
            { degree: null },
            { id: { gt: cursor.id } },
          ],
        };
      }
      return {
        OR: [
          { degree: { lt: cursor.degree } },
          { degree: cursor.degree, id: { gt: cursor.id } },
          { degree: null },
        ],
      };
    }

    case 'volume_asc': {
      if (cursor.volume == null) {
        return {
          OR: [
            { volume: null, id: { gt: cursor.id } },
            { volume: { not: null } },
          ],
        };
      }
      return {
        OR: [
          { volume: { gt: cursor.volume } },
          { volume: cursor.volume, id: { gt: cursor.id } },
        ],
      };
    }

    case 'volume_desc': {
      if (cursor.volume == null) {
        return {
          AND: [
            { volume: null },
            { id: { gt: cursor.id } },
          ],
        };
      }
      return {
        OR: [
          { volume: { lt: cursor.volume } },
          { volume: cursor.volume, id: { gt: cursor.id } },
          { volume: null },
        ],
      };
    }

    case 'popular': {
      const hasManual = cursor.manualScore != null;
      const hasScore = cursor.score != null;

      if (hasManual) {
        if (hasScore) {
          return {
            OR: [
              { score: { manualScore: { lt: cursor.manualScore } } },
              {
                AND: [
                  { score: { manualScore: cursor.manualScore } },
                  { score: { score: { lt: cursor.score } } },
                ],
              },
              {
                AND: [
                  { score: { manualScore: cursor.manualScore } },
                  { score: { score: cursor.score } },
                  { id: { gt: cursor.id } },
                ],
              },
              { score: { manualScore: null } },
              { score: null },
            ],
          };
        }
        return {
          OR: [
            { score: { manualScore: { lt: cursor.manualScore } } },
            {
              AND: [
                { score: { manualScore: cursor.manualScore } },
                { score: { score: null } },
                { id: { gt: cursor.id } },
              ],
            },
            { score: { manualScore: null } },
            { score: null },
          ],
        };
      }

      if (hasScore) {
        return {
          OR: [
            {
              AND: [
                { score: { manualScore: null } },
                { score: { score: { lt: cursor.score } } },
              ],
            },
            {
              AND: [
                { score: { manualScore: null } },
                { score: { score: cursor.score } },
                { id: { gt: cursor.id } },
              ],
            },
            {
              AND: [
                { score: { manualScore: null } },
                { score: { score: null } },
              ],
            },
            { score: null },
          ],
        };
      }

      return {
        OR: [
          {
            AND: [
              { score: { manualScore: null } },
              { score: { score: null } },
              { id: { gt: cursor.id } },
            ],
          },
          {
            AND: [
              { score: null },
              { id: { gt: cursor.id } },
            ],
          },
        ],
      };
    }


    default:         // без сортировки
      return { id: { gt: cursor.id } };
  }
}
