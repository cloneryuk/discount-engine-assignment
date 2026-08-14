import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCart, priceItem } from '../src/engine.js';
import { parseCartCsv, parseRulesCsv, parsePdfText, parseRuleText } from '../src/parsers.js';

/* ── Fixtures ───────────────────────────────────────────── */

const rules = [
  { id: 'RULE-01', scope: 'platform', appliesTo: 'Amazon India', type: 'percentage', value: 15, stackable: false },
  { id: 'RULE-02', scope: 'brand', appliesTo: 'Natura Casa', type: 'flat', value: 150, stackable: false },
  { id: 'RULE-03', scope: 'platform', appliesTo: 'Flipkart', type: 'percentage', value: 10, stackable: true },
  { id: 'RULE-04', scope: 'cart', appliesTo: '', type: 'percentage', value: 10, stackable: false, minCartValue: 4000 },
];

const items = [
  ['ITEM-01', 'Cushion Cover', 'Natura Casa', 'Amazon India', 1299],
  ['ITEM-02', 'Bed Sheet Set', 'Natura Casa', 'Flipkart', 849],
  ['ITEM-03', 'Wall Shelf', 'LivSpace Pro', 'Amazon India', 599],
  ['ITEM-04', 'Ceramic Vase', 'LivSpace Pro', 'Noon', 2499],
  ['ITEM-05', 'Cutting Board', 'Nordic Basics', 'Amazon India', 449],
  ['ITEM-06', 'Desk Organiser', 'Nordic Basics', 'Flipkart', 899],
].map(([id, product, brand, platform, basePrice]) => ({ id, product, brand, platform, basePrice }));


/* ── 1. Sample expected totals ──────────────────────────── */

test('calculates Opptra sample cart exactly', () => {
  const result = calculateCart(items, rules);
  assert.deepEqual(
    result.itemResults.map((r) => Math.round(r.finalPrice)),
    [1104, 629, 509, 2499, 382, 809],
  );
  assert.equal(Math.round(result.subtotal), 5932);
  assert.equal(Math.round(result.cartSaving), 593);
  assert.equal(Math.round(result.finalTotal), 5339);
});


/* ── 2. Largest non-stackable saving wins ───────────────── */

test('picks the non-stackable rule with the largest rupee saving', () => {
  const twoNonStackable = [
    { id: 'R-A', scope: 'brand', appliesTo: 'TestBrand', type: 'percentage', value: 10, stackable: false },
    { id: 'R-B', scope: 'brand', appliesTo: 'TestBrand', type: 'flat', value: 200, stackable: false },
  ];
  const item = { id: 'T1', product: 'Widget', brand: 'TestBrand', platform: 'SomeShop', basePrice: 1000 };
  const result = priceItem(item, twoNonStackable);
  // R-B saves Rs.200 vs R-A Rs.100 → R-B wins
  assert.equal(Math.round(result.finalPrice), 800);
  assert.equal(result.applied.length, 1);
  assert.equal(result.applied[0].id, 'R-B');
});


/* ── 3. Stackable behaviour ─────────────────────────────── */

test('stackable rules apply after the winning non-stackable rule', () => {
  const mixedRules = [
    { id: 'NS', scope: 'platform', appliesTo: 'Amazon', type: 'flat', value: 100, stackable: false },
    { id: 'ST', scope: 'platform', appliesTo: 'Amazon', type: 'percentage', value: 10, stackable: true },
  ];
  const item = { id: 'T2', product: 'Lamp', brand: 'AnyBrand', platform: 'Amazon', basePrice: 500 };
  const result = priceItem(item, mixedRules);
  // 500 - 100 = 400, then 10% of 400 = 40 → 360
  assert.equal(Math.round(result.finalPrice), 360);
  assert.equal(result.applied.length, 2);
});

test('stackable-only rules apply normally when no non-stackable rules match', () => {
  const stackOnly = [
    { id: 'S1', scope: 'brand', appliesTo: 'BrandX', type: 'percentage', value: 10, stackable: true },
    { id: 'S2', scope: 'brand', appliesTo: 'BrandX', type: 'flat', value: 50, stackable: true },
  ];
  const item = { id: 'T3', product: 'Mug', brand: 'BrandX', platform: 'Etsy', basePrice: 300 };
  const result = priceItem(item, stackOnly);
  // 300 * 0.9 = 270, then 270 - 50 = 220
  assert.equal(Math.round(result.finalPrice), 220);
  assert.equal(result.applied.length, 2);
});


/* ── 4. Cart threshold boundary ─────────────────────────── */

test('does not apply cart rule below the threshold', () => {
  const result = calculateCart(items.slice(0, 2), rules);
  assert.equal(result.cartOffers.length, 0);
  assert.equal(Math.round(result.finalTotal), Math.round(result.subtotal));
});

test('applies cart rule when subtotal exactly meets the threshold', () => {
  const cartRule = [
    { id: 'CR', scope: 'cart', appliesTo: '', type: 'percentage', value: 5, stackable: false, minCartValue: 500 },
  ];
  const item = [{ id: 'E1', product: 'Exact', brand: 'B', platform: 'P', basePrice: 500 }];
  const result = calculateCart(item, cartRule);
  assert.equal(result.cartOffers.length, 1);
  assert.equal(Math.round(result.cartSaving), 25); // 5% of 500
});

test('does not apply cart rule one rupee below the threshold', () => {
  const cartRule = [
    { id: 'CR', scope: 'cart', appliesTo: '', type: 'percentage', value: 5, stackable: false, minCartValue: 500 },
  ];
  const item = [{ id: 'E2', product: 'Under', brand: 'B', platform: 'P', basePrice: 499 }];
  const result = calculateCart(item, cartRule);
  assert.equal(result.cartOffers.length, 0);
});


/* ── 5. No-match item shows "No offers available" ───────── */

test('item with no matching rules retains base price and shows no offers', () => {
  const item = { id: 'NM', product: 'Orphan', brand: 'Unknown', platform: 'Nowhere', basePrice: 750 };
  const result = priceItem(item, rules);
  assert.equal(result.finalPrice, 750);
  assert.equal(result.status, 'No offers available');
  assert.equal(result.explanation, 'No offers available');
});


/* ── 6. Multiple cart rules: best non-stackable + stackable ─ */

test('multiple cart rules: best non-stackable wins, stackable applies after', () => {
  const multiCart = [
    { id: 'C1', scope: 'cart', appliesTo: '', type: 'percentage', value: 10, stackable: false, minCartValue: 100 },
    { id: 'C2', scope: 'cart', appliesTo: '', type: 'flat', value: 20, stackable: false, minCartValue: 100 },
    { id: 'C3', scope: 'cart', appliesTo: '', type: 'flat', value: 5, stackable: true, minCartValue: 100 },
  ];
  const item = [{ id: 'MC', product: 'Item', brand: 'B', platform: 'P', basePrice: 1000 }];
  const result = calculateCart(item, multiCart);
  // C1 saves 100, C2 saves 20 → C1 wins → 900, then C3 → 895
  assert.equal(Math.round(result.finalTotal), 895);
  assert.equal(result.cartOffers.length, 2);
  assert.equal(result.cartOffers[0].id, 'C1');
});


/* ── 7. Natural-language rule parsing ───────────────────── */

test('parses the three assignment NL rule examples', () => {
  const brand = parseRuleText('20% off for Natura Casa brand, stackable with other offers');
  const platform = parseRuleText('Rs.100 flat discount on all Flipkart items');
  const cart = parseRuleText('10% off if cart value is more than Rs.5,000');

  assert.equal(brand.ok, true);
  assert.deepEqual(
    [brand.rule.scope, brand.rule.appliesTo, brand.rule.type, brand.rule.value, brand.rule.stackable],
    ['brand', 'Natura Casa', 'percentage', 20, true],
  );

  assert.equal(platform.ok, true);
  assert.deepEqual(
    [platform.rule.scope, platform.rule.appliesTo, platform.rule.type, platform.rule.value],
    ['platform', 'Flipkart', 'flat', 100],
  );

  assert.equal(cart.ok, true);
  assert.deepEqual(
    [cart.rule.scope, cart.rule.type, cart.rule.value, cart.rule.minCartValue],
    ['cart', 'percentage', 10, 5000],
  );
});

test('rejects ambiguous / invalid natural-language input', () => {
  const vague = parseRuleText('Give a discount for big orders');
  assert.equal(vague.ok, false);
  assert.ok(vague.message.length > 0);
});


/* ── 8. Malformed CSV handling ──────────────────────────── */

test('rejects a CSV with only a header and no data rows', () => {
  assert.throws(() => parseCartCsv('item_id,product,brand,platform,base_price\n'), {
    message: /header row/i,
  });
});

test('rejects a cart CSV row that is missing required fields', () => {
  assert.throws(
    () => parseCartCsv('item_id,product,brand,platform,base_price\nITEM-01,Widget,,,500\n'),
    { message: /malformed/i },
  );
});

test('rejects a rules CSV with an invalid scope', () => {
  assert.throws(
    () => parseRulesCsv('rule_id,scope,applies_to,type,value,stackable,min_cart_value\nR1,galaxy,Mars,flat,100,false,\n'),
    { message: /scope/i },
  );
});


/* ── 9. PDF text parsing ────────────────────────────────── */

test('imports a text-based cart PDF table and skips non-table lines', () => {
  const table = [
    'Order #OP-9921',
    'Product  Brand  Platform  Base Price',
    'Cushion Cover  Natura Casa  Amazon India  Rs.1,299',
    'Bed Sheet Set  Natura Casa  Flipkart  Rs.849',
  ].join('\n');
  const result = parsePdfText(table);
  assert.deepEqual(result.items.map((i) => i.product), ['Cushion Cover', 'Bed Sheet Set']);
  assert.equal(result.items[0].basePrice, 1299);
});

test('throws when PDF text has no parseable rows', () => {
  assert.throws(() => parsePdfText('Random gibberish with no table'), {
    message: /no valid rows/i,
  });
});
