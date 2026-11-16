import { describe, expect, it } from 'vitest';
import { parseRules, resolveAssistants, RuleError, soldFor } from './counter-rules';

describe('parseRules', () => {
  it('reads the circular wording', () => {
    expect(parseRules('16, 17, 14, 15 below 5K + 03')).toEqual([
      { codes: ['16', '17', '14', '15'], below: 5000, above: null },
      { codes: ['3'], below: null, above: null },
    ]);
    expect(parseRules('07, 08, 23 above 30000')).toEqual([{ codes: ['7', '8', '23'], below: null, above: 30000 }]);
    expect(parseRules('40,18 and 13')[0].codes).toEqual(['40', '18', '13']);
  });
  it('rejects what it cannot read', () => {
    expect(() => parseRules('')).toThrow(RuleError);
    expect(() => parseRules('14 below lots')).toThrow(RuleError);
  });
});

describe('soldFor', () => {
  const rows = [
    { code: '14', tagPrice: 4999, qty: 10 },
    { code: '14', tagPrice: 5000, qty: 4 },
    { code: '03', tagPrice: 90000, qty: 2 },
    { code: '3', tagPrice: 100, qty: -1 },
    { code: '52', tagPrice: 100, qty: 7 },
  ];
  it('counts pieces under the price as below, the price and over as above, net of returns', () => {
    expect(soldFor(parseRules('14 below 5K + 03'), rows).total).toBe(11);
    expect(soldFor(parseRules('14 above 5K'), rows).total).toBe(4);
    expect([...soldFor(parseRules('14 below 5K + 03'), rows).byCode]).toEqual([['14', 10], ['3', 1]]);
  });
});

describe('resolveAssistants', () => {
  const people = [
    { employeeCode: 'DBYA0077', fullName: 'Ravi Kumar BS' }, { employeeCode: 'DBYA0074', fullName: 'Jyothi S' },
    { employeeCode: 'DBYA0025', fullName: 'Jyothi Damodar' }, { employeeCode: 'DBYA0063', fullName: 'RAJ KUMAR' },
  ];
  it('matches names, IDs and unique prefixes, and keeps the rest as written', () => {
    expect(resolveAssistants('RAVIKUMAR, JYOTHI S, dbya0063, Jyothi, Shwetha', people)).toEqual([people[0], people[1], people[3], 'Jyothi', 'Shwetha']);
  });
});
