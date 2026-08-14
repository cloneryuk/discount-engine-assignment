export const roundRupee = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

export function money(value) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 0,
  }).format(Math.round(value)).replace('₹', 'Rs.');
}

export function ruleMatchesItem(rule, item) {
  if (rule.scope === 'brand') return normalize(rule.appliesTo) === normalize(item.brand);
  if (rule.scope === 'platform') return normalize(rule.appliesTo) === normalize(item.platform);
  return false;
}

function normalize(value = '') { return String(value).trim().toLowerCase(); }

export function savingFor(rule, amount) {
  const raw = rule.type === 'percentage' ? amount * (Number(rule.value) / 100) : Number(rule.value);
  return roundRupee(Math.max(0, Math.min(amount, raw)));
}

function applyRule(amount, rule) {
  const saving = savingFor(rule, amount);
  return { amount: roundRupee(amount - saving), saving };
}

function describeRule(rule, saving) {
  const value = rule.type === 'percentage' ? `${rule.value}% off` : `${money(rule.value)} off`;
  return `${rule.id} - ${value} (${money(saving)} saved)`;
}

export function priceItem(item, rules) {
  const matching = rules.filter((rule) => rule.scope !== 'cart' && ruleMatchesItem(rule, item));
  const nonStackable = matching.filter((rule) => !rule.stackable);
  const stackable = matching.filter((rule) => rule.stackable);

  let current = Number(item.basePrice);
  const applied = [];
  if (nonStackable.length) {
    const winner = nonStackable
      .map((rule) => ({ rule, saving: savingFor(rule, current) }))
      .sort((a, b) => b.saving - a.saving || a.rule.id.localeCompare(b.rule.id))[0];
    const result = applyRule(current, winner.rule);
    current = result.amount;
    applied.push({ ...winner.rule, saving: result.saving, kind: 'best non-stackable' });
  }
  for (const rule of stackable) {
    const result = applyRule(current, rule);
    current = result.amount;
    applied.push({ ...rule, saving: result.saving, kind: 'stacked' });
  }
  const totalSaving = roundRupee(Number(item.basePrice) - current);
  return {
    item, finalPrice: current, totalSaving,
    applied,
    status: applied.length === 0 ? 'No offers available' : applied.length > 1 ? 'Stacked offers' : applied[0].kind === 'best non-stackable' && nonStackable.length > 1 ? 'Maximum discount selected' : 'Discount applied',
    explanation: applied.length ? applied.map((rule) => describeRule(rule, rule.saving)).join(' + ') : 'No offers available',
  };
}

function eligibleCartRules(rules, subtotal) {
  return rules.filter((rule) => rule.scope === 'cart' && subtotal >= Number(rule.minCartValue || 0));
}

export function calculateCart(items, rules) {
  const itemResults = items.map((item) => priceItem(item, rules));
  const subtotal = roundRupee(itemResults.reduce((sum, result) => sum + result.finalPrice, 0));
  const matching = eligibleCartRules(rules, subtotal);
  const nonStackable = matching.filter((rule) => !rule.stackable);
  const stackable = matching.filter((rule) => rule.stackable);
  let current = subtotal;
  const cartOffers = [];
  if (nonStackable.length) {
    const winner = nonStackable
      .map((rule) => ({ rule, saving: savingFor(rule, current) }))
      .sort((a, b) => b.saving - a.saving || a.rule.id.localeCompare(b.rule.id))[0];
    const result = applyRule(current, winner.rule);
    current = result.amount;
    cartOffers.push({ ...winner.rule, saving: result.saving, kind: 'best cart offer' });
  }
  for (const rule of stackable) {
    const result = applyRule(current, rule);
    current = result.amount;
    cartOffers.push({ ...rule, saving: result.saving, kind: 'stacked cart offer' });
  }
  return { itemResults, subtotal, cartOffers, cartSaving: roundRupee(subtotal - current), finalTotal: current };
}
