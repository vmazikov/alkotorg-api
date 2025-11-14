import { prepareSearchQuery } from '../src/utils/searchQuery.js';

describe('prepareSearchQuery', () => {
  it('returns null for empty input', () => {
    expect(prepareSearchQuery('   ')).toBeNull();
    expect(prepareSearchQuery(null)).toBeNull();
  });

  it('normalizes tokens and adds category synonym', () => {
    const result = prepareSearchQuery(' Водка   Царь!!! ');
    expect(result).not.toBeNull();
    expect(result.tokens).toEqual(expect.arrayContaining(['водка', 'царь', 'vodka']));
    expect(result.tsQueryText.split(' ')).toEqual(expect.arrayContaining(['водка', 'царь', 'vodka']));
  });

  it('sanitizes dangerous symbols and limits tokens', () => {
    const input = "whisky & brandy | tequila <test>";
    const result = prepareSearchQuery(input);
    expect(result.tokens).toEqual(expect.arrayContaining(['whisky', 'brandy', 'tequila']));
    expect(result.tsQueryText.includes('&')).toBe(false);
    expect(result.tsQueryText.includes('|')).toBe(false);
  });

  it('recovers tokens when user types with wrong keyboard layout', () => {
    const result = prepareSearchQuery('djlrf wfhq'); // «водка царь» на EN раскладке
    expect(result.tokens).toEqual(expect.arrayContaining(['водка', 'царь']));
  });
});
