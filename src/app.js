import { calculateCart, money } from './engine.js';
import { parseCartCsv, parseCartPdf, parseRuleText, parseRulesCsv } from './parsers.js';

const sampleRules = [
  { id: 'RULE-01', scope: 'platform', appliesTo: 'Amazon India', type: 'percentage', value: 15, stackable: false, minCartValue: 0 },
  { id: 'RULE-02', scope: 'brand', appliesTo: 'Natura Casa', type: 'flat', value: 150, stackable: false, minCartValue: 0 },
  { id: 'RULE-03', scope: 'platform', appliesTo: 'Flipkart', type: 'percentage', value: 10, stackable: true, minCartValue: 0 },
  { id: 'RULE-04', scope: 'cart', appliesTo: '', type: 'percentage', value: 10, stackable: false, minCartValue: 4000 },
];
const sampleCart = [
  ['ITEM-01', 'Cushion Cover', 'Natura Casa', 'Amazon India', 1299],
  ['ITEM-02', 'Bed Sheet Set', 'Natura Casa', 'Flipkart', 849],
  ['ITEM-03', 'Wall Shelf', 'LivSpace Pro', 'Amazon India', 599],
  ['ITEM-04', 'Ceramic Vase', 'LivSpace Pro', 'Noon', 2499],
  ['ITEM-05', 'Cutting Board', 'Nordic Basics', 'Amazon India', 449],
  ['ITEM-06', 'Desk Organiser', 'Nordic Basics', 'Flipkart', 899],
].map(([id, product, brand, platform, basePrice]) => ({ id, product, brand, platform, basePrice }));

const state = { rules: [], items: [], source: 'Awaiting data' };
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v).replace(/[&<>'"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[c]);
function setStatus(sel, msg, err = false) { const el = $(sel); el.textContent = msg; el.classList.toggle('error', err); }
function valLabel(r) { return r.type === 'percentage' ? `${r.value}%` : money(r.value); }

function render() {
  const n = state.items.length;
  $('#data-summary').textContent = `${state.source} · ${n} item${n !== 1 ? 's' : ''}, ${state.rules.length} rule${state.rules.length !== 1 ? 's' : ''}`;

  if (!n) {
    $('#results').innerHTML = '<div class="card empty-state">Please upload rules and a cart to calculate discounts.</div>';
    return;
  }

  const r = calculateCart(state.items, state.rules);

  $('#results').innerHTML = `
    <table class="items-table">
      <thead>
        <tr>
          <th>ITEM</th>
          <th>BASE PRICE</th>
          <th>RULE(S) APPLIED</th>
          <th>FINAL PRICE</th>
          <th>STATUS</th>
        </tr>
      </thead>
      <tbody>
        ${r.itemResults.map(({ item, finalPrice, explanation, status }) => {
          let dispExp = explanation === 'No offers available' ? 'No rules match' : explanation;
          let dispStat = status === 'No offers available' ? 'No offer' :
                         status === 'Maximum discount selected' ? 'Max discount' :
                         status === 'Stacked offers' ? 'Stacked' : status;
          return `
          <tr>
            <td>${esc(item.id)}</td>
            <td>${money(item.basePrice)}</td>
            <td>${esc(dispExp)}</td>
            <td class="td-price">${money(finalPrice)}</td>
            <td><span class="badge badge-${dispStat.includes('No') ? 'gray' : dispStat.includes('Stack') ? 'blue' : 'green'}">${esc(dispStat)}</span></td>
          </tr>`}).join('')}
        <tr class="row-subtotal">
          <td colspan="3"><strong>Cart Total before offer</strong></td>
          <td colspan="2" class="td-price">${money(r.subtotal)}</td>
        </tr>
        ${r.cartOffers.map((o) => `
          <tr class="row-offer">
            <td colspan="2"><strong>Cart Offer — ${esc(o.id)}</strong></td>
            <td>${valLabel(o)} off entire cart</td>
            <td class="td-price text-green">−${money(o.saving)}</td>
            <td><span class="badge badge-green">Cart offer</span></td>
          </tr>
        `).join('')}
        <tr class="row-total">
          <td colspan="3"><strong>Final Cart Total</strong></td>
          <td colspan="2" class="td-price td-large">${money(r.finalTotal)}</td>
        </tr>
      </tbody>
    </table>`;
}

function showConfirmation(rule) {
  const host = $('#confirmation');
  const frag = $('#confirmation-template').content.cloneNode(true);
  const pairs = [
    ['Scope', rule.scope], ['Applies to', rule.appliesTo || 'Cart'],
    ['Type', rule.type], ['Value', valLabel(rule)],
    ['Stackable', rule.stackable ? 'Yes' : 'No'],
    ...(rule.scope === 'cart' ? [['Min cart', money(rule.minCartValue)]] : []),
  ];
  frag.querySelector('.rule-fields').innerHTML = pairs.map(([l, v]) => `<div><dt>${l}</dt><dd>${esc(v)}</dd></div>`).join('');
  frag.querySelector('.confirm').addEventListener('click', () => {
    state.rules.push(rule); state.source = 'Updated'; host.hidden = true;
    $('#rule-input').value = ''; setStatus('#parse-feedback', `Added ${rule.id}. Cart repriced.`); render();
  });
  frag.querySelector('.discard').addEventListener('click', () => { host.hidden = true; setStatus('#parse-feedback', 'Discarded.'); });
  host.replaceChildren(frag); host.hidden = false;
}

async function readFile(el) { return el.files?.[0] ? el.files[0].text() : null; }

$('#rules-upload').addEventListener('change', async (e) => {
  try { const t = await readFile(e.target); if (!t) return; const r = parseRulesCsv(t); state.rules = r; state.source = 'Custom rules'; setStatus('#rules-status', `${r.length} rule(s) loaded`); render(); }
  catch (err) { setStatus('#rules-status', err.message, true); }
});
$('#cart-upload').addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  const isPdf = f.name.toLowerCase().endsWith('.pdf') || f.type === 'application/pdf';

  if (isPdf) {
    setStatus('#cart-status', 'Reading PDF…');
    try { const { items, errors } = await parseCartPdf(f); state.items = items; state.source = 'PDF cart'; setStatus('#cart-status', `${items.length} item(s)${errors.length ? `, ${errors.length} skipped` : ''}`, errors.length > 0); render(); }
    catch (err) { setStatus('#cart-status', err.message, true); }
  } else {
    try { const t = await readFile(e.target); if (!t) return; const i = parseCartCsv(t); state.items = i; state.source = 'CSV cart'; setStatus('#cart-status', `${i.length} item(s) loaded`); render(); }
    catch (err) { setStatus('#cart-status', err.message, true); }
  }
});
$('#rule-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#parse-rule-btn');
  btn.disabled = true; btn.textContent = 'Parsing…';
  setStatus('#parse-feedback', 'Sending to Gemini…'); $('#confirmation').hidden = true;
  try {
    const p = await parseRuleText($('#rule-input').value);
    if (!p.ok) { setStatus('#parse-feedback', p.message, true); return; }
    setStatus('#parse-feedback', 'Review below:'); showConfirmation(p.rule);
  } catch (err) { setStatus('#parse-feedback', err.message, true); }
  finally { btn.disabled = false; btn.textContent = 'Parse'; }
});
$('#reset').addEventListener('click', () => {
  state.rules = structuredClone(sampleRules); state.items = structuredClone(sampleCart); state.source = 'Sample data';
  $('#confirmation').hidden = true; setStatus('#rules-status', ''); setStatus('#cart-status', ''); setStatus('#parse-feedback', ''); render();
});

render();
