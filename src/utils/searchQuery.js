// Нормализация поисковых запросов + синонимы для категорий.
const CATEGORY_SYNONYMS = [
  { canonical: 'vodka', terms: ['vodka', 'vdk', 'водка', 'водки', 'водку', 'vodka'] },
  { canonical: 'whisky', terms: ['whisky', 'whiskey', 'scotch', 'bourbon', 'виски', 'бурбон'] },
  { canonical: 'cognac', terms: ['cognac', 'коньяк', 'коньяки', 'konyak'] },
  { canonical: 'brandy', terms: ['brandy', 'бренди'] },
  { canonical: 'rum', terms: ['rum', 'ром', 'рома'] },
  { canonical: 'gin', terms: ['gin', 'джин'] },
  { canonical: 'tequila', terms: ['tequila', 'текила', 'tekila'] },
  { canonical: 'wine', terms: ['wine', 'вино', 'вина', 'vino'] },
  { canonical: 'champagne', terms: ['champagne', 'шампанское', 'шампань', 'champ'] },
  { canonical: 'beer', terms: ['beer', 'пиво', 'пива'] },
  { canonical: 'vermouth', terms: ['vermouth', 'вермут'] },
  { canonical: 'liqueur', terms: ['liqueur', 'ликер', 'ликёр', 'liker'] },
  { canonical: 'cider', terms: ['cider', 'сидр'] },
  { canonical: 'absinthe', terms: ['absinthe', 'абсент'] },
  { canonical: 'armagnac', terms: ['armagnac', 'арманьяк'] },
  { canonical: 'porto', terms: ['porto', 'портвейн'] },
  { canonical: 'sake', terms: ['sake', 'саке'] },
];

const TOKEN_SPLIT_RE = /[^\p{L}\p{N}]+/u;
const SANITIZE_TSQUERY = /[':?!&|<>]/g;
const DIACRITIC_RE = /\p{Diacritic}/gu;
const MAX_TOKENS = 8;

const synonymMap = new Map();
for (const { canonical, terms } of CATEGORY_SYNONYMS) {
  const full = Array.from(new Set([canonical, ...(terms || [])]));
  for (const term of full) {
    synonymMap.set(term, canonical);
  }
}

const stripDiacritics = value =>
  value
    ?.normalize('NFKD')
    .replace(DIACRITIC_RE, '')
    .normalize('NFKC');

const sanitizeToken = token => stripDiacritics(token?.toLowerCase()?.trim() ?? '');

const enToRuMap = new Map([
  ['q', 'й'], ['w', 'ц'], ['e', 'у'], ['r', 'к'], ['t', 'е'],
  ['y', 'н'], ['u', 'г'], ['i', 'ш'], ['o', 'щ'], ['p', 'з'],
  ['[', 'х'], [']', 'ъ'], ['a', 'ф'], ['s', 'ы'], ['d', 'в'],
  ['f', 'а'], ['g', 'п'], ['h', 'р'], ['j', 'о'], ['k', 'л'],
  ['l', 'д'], [';', 'ж'], ["'", 'э'], ['z', 'я'], ['x', 'ч'],
  ['c', 'с'], ['v', 'м'], ['b', 'и'], ['n', 'т'], ['m', 'ь'],
  [',', 'б'], ['.', 'ю'], ['`', 'ё'],
]);

const ruToEnMap = new Map(Array.from(enToRuMap.entries()).map(([en, ru]) => [ru, en]));

const convertLayout = (value, layoutMap) => {
  if (!value) return value;
  let result = '';
  for (const char of value) {
    const lower = char.toLowerCase();
    const replacement = layoutMap.get(lower);
    if (replacement) {
      result += char === lower ? replacement : replacement.toUpperCase();
    } else {
      result += char;
    }
  }
  return result;
};

export function prepareSearchQuery(raw) {
  const base = String(raw ?? '').trim();
  if (!base) return null;

  const sanitized = base
    .toLowerCase()
    .replace(SANITIZE_TSQUERY, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!sanitized) return null;

  const hasCyrillic = /[а-яё]/i.test(sanitized);
  const hasLatin = /[a-z]/i.test(sanitized);

  const tokensFrom = value =>
    value
      .split(TOKEN_SPLIT_RE)
      .map(sanitizeToken)
      .filter(Boolean)
      .filter(token => token.length >= 2);

  const primaryTokens = tokensFrom(sanitized);

  const altVariants = [];
  if (hasLatin && !hasCyrillic) {
    altVariants.push(
      convertLayout(sanitized, enToRuMap)
        .replace(/\s+/g, ' ')
        .trim()
    );
  } else if (hasCyrillic && !hasLatin) {
    altVariants.push(
      convertLayout(sanitized, ruToEnMap)
        .replace(/\s+/g, ' ')
        .trim()
    );
  }

  const alternativeTokenLists = altVariants
    .map(tokensFrom)
    .filter(list => list.length);

  const tokenSources = [primaryTokens, ...alternativeTokenLists].filter(list => list.length);
  const maxLength = Math.max(0, ...tokenSources.map(list => list.length));
  if (!maxLength) return null;

  const canonicalExtras = [];
  const tokenGroups = [];

  for (let i = 0; i < maxLength && tokenGroups.length < MAX_TOKENS; i++) {
    const group = new Set();
    for (const source of tokenSources) {
      const token = source[i];
      if (token) group.add(token);
    }
    if (!group.size) continue;

    for (const token of Array.from(group)) {
      const canonical = synonymMap.get(token);
      if (canonical) {
        group.add(canonical);
        canonicalExtras.push(canonical);
      }
    }

    tokenGroups.push(Array.from(group));
  }

  const uniqueTokens = [];
  const pushUnique = token => {
    if (!uniqueTokens.includes(token)) uniqueTokens.push(token);
  };
  tokenGroups.forEach(group => group.forEach(pushUnique));

  const uniqueCanonicals = Array.from(new Set(canonicalExtras));
  const tsTokens = uniqueTokens.slice(0, MAX_TOKENS);

  return {
    normalized: base,
    tokens: uniqueTokens,
    tokenGroups,
    synonyms: uniqueCanonicals,
    tsQueryText: tsTokens.join(' '),
  };
}
