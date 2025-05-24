// src/routes/filters.routes.js
import { Router }   from 'express';
import prisma       from '../utils/prisma.js';
import buildWhere   from '../utils/buildWhere.js';
import buildCursor from '../utils/buildCursor.js';

const router = Router();

/**
 * GET /filters
 * Возвращает списки значений для чек-боксов и массив всех категорий (types).
 *   Принимает те же query-string, что и /products, -- поэтому
 *   выдаёт *контекстные* списки (например, внутри выбранной категории).
 *
 * Структура ответа:
 * {
 *   types:          [ 'wine', 'whisky', … ],
 *   volumes:        [ 0.5, 0.7, 1 ],
 *   brands:         [ 'Jack Daniel’s', … ],
 *   wineColors:     [ 'Красное', 'Белое', … ],
 *   sweetnessLevels:[ 'Сухое', 'Полусладкое', … ],
 *   …
 * }
 */
router.get('/', async (req, res, next) => {
  try {
    const where = buildWhere(req.query);

    /* ------------- запросы параллельно -------------------------------- */
    const [
      types, volumes, brands, wineColors, sweetnessLevels, wineTypes,
      giftPackagings, excerpts, tastes, countries, whiskyTypes,
    ] = await Promise.all([
      prisma.product.findMany({ where, select:{ type:true           }, distinct:['type']           }),
      prisma.product.findMany({ where, select:{ volume:true         }, distinct:['volume']         }),
      prisma.product.findMany({ where, select:{ brand:true          }, distinct:['brand']          }),
      prisma.product.findMany({ where, select:{ wineColor:true      }, distinct:['wineColor']      }),
      prisma.product.findMany({ where, select:{ sweetnessLevel:true }, distinct:['sweetnessLevel'] }),
      prisma.product.findMany({ where, select:{ wineType:true       }, distinct:['wineType']       }),
      prisma.product.findMany({ where, select:{ giftPackaging:true  }, distinct:['giftPackaging']  }),
      prisma.product.findMany({ where, select:{ excerpt:true        }, distinct:['excerpt']        }),
      prisma.product.findMany({ where, select:{ taste:true          }, distinct:['taste']          }),
      prisma.product.findMany({ where, select:{ countryOfOrigin:true}, distinct:['countryOfOrigin']}),
      prisma.product.findMany({ where, select:{ whiskyType:true     }, distinct:['whiskyType']     }),
    ]);

    /* ------------- ответ ------------------------------------------------ */
    res.set('Cache-Control', 'no-store');      // нельзя кешировать, т.к. зависит от auth
    res.json({
      types:           types          .map(v => v.type)            .filter(Boolean).sort(),
      volumes:         volumes        .map(v => v.volume)          .filter(Boolean).sort((a,b)=>a-b),
      brands:          brands         .map(v => v.brand)           .filter(Boolean).sort(),
      wineColors:      wineColors     .map(v => v.wineColor)       .filter(Boolean).sort(),
      sweetnessLevels: sweetnessLevels.map(v => v.sweetnessLevel) .filter(Boolean).sort(),
      wineTypes:       wineTypes      .map(v => v.wineType)        .filter(Boolean).sort(),
      giftPackagings:  giftPackagings .map(v => v.giftPackaging)   .filter(Boolean).sort(),
      excerpts:        excerpts       .map(v => v.excerpt)         .filter(Boolean).sort(),
      tastes:          tastes         .map(v => v.taste)           .filter(Boolean).sort(),
      countries:       countries      .map(v => v.countryOfOrigin) .filter(Boolean).sort(),
      whiskyTypes:     whiskyTypes    .map(v => v.whiskyType)      .filter(Boolean).sort(),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
