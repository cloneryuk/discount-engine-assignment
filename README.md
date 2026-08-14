# Opptra Discount Engine

A customer-facing cart pricing engine that selects the best non-stackable discount, applies stackable offers on top, evaluates cart-level offers, and shows every customer exactly how their final price was calculated.

---

## 🔗 Links

| | URL |
|---|---|
| **Live deployment** | [https://glittery-beignet-d2c449.netlify.app/](https://glittery-beignet-d2c449.netlify.app/) |
| **GitHub repo** | [https://github.com/cloneryuk/discount-engine-assignment](https://github.com/cloneryuk/discount-engine-assignment) |

---

## 🚀 Run locally

1. Clone the repository and enter the directory:
   ```bash
   git clone https://github.com/cloneryuk/discount-engine-assignment.git
   cd discount-engine-assignment
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the development server:
   ```bash
   npm run dev
   ```
   *(Then open the local URL shown in your terminal, usually http://localhost:5173 or 5174)*

---

## 🧪 Test & build

```bash
npm test             # runs all automated tests
npm run build        # writes deployable static site to dist/
```

---

## 🏗️ Implementation & Design Decisions

### Architecture

The codebase is split into three independent modules with no circular dependencies:

| Module | Responsibility |
|---|---|
| `engine.js` | Pure pricing logic — `priceItem()` and `calculateCart()` take plain objects, return results. Zero UI or I/O awareness. |
| `parsers.js` | All input handling — CSV parsing, PDF text extraction (PDF.js), natural-language rule parsing, and strict validation (`validateRule`, `validateItem`). |
| `app.js` | UI wiring — DOM event listeners, state management, rendering. Calls engine + parsers but never mixes concerns. |

### Discount logic

1. **Non-stackable selection**: When multiple non-stackable rules match an item, the one producing the largest rupee saving wins. Ties are broken by rule ID for deterministic results.
2. **Stackable application**: Stackable rules apply sequentially (by rule-ID order) on top of the post-non-stackable price. If only stackable rules match, they apply normally with no non-stackable step.
3. **No match**: Items with no matching rule retain their base price and display "No offers available."
4. **Cart-level offers**: Cart rules run after all item prices are calculated. They use the discounted item subtotal, not the original total. A cart rule applies only when the subtotal meets or exceeds its `minCartValue`.
5. **Multiple cart rules**: Best non-stackable cart saving wins; stackable cart rules apply afterward — identical logic to item-level rules.

### Natural-language rule parser (Gemini LLM)

The parser (`parseRuleText`) calls **Google Gemini 3.5 Flash** to convert free-form English into structured rule JSON. The LLM receives a tightly constrained prompt that enforces the exact schema (`scope`, `type`, `value`, `appliesTo`, `stackable`, `minCartValue`) and rejects vague input with a clear error.

| Input | Parsed output |
|---|---|
| "20% off for Natura Casa brand, stackable with other offers" | Brand / Natura Casa / Percentage / 20 / stackable |
| "Rs.100 flat discount on all Flipkart items" | Platform / Flipkart / Flat / 100 / not stackable |
| "10% off if cart value is more than Rs.5,000" | Cart / Percentage / 10 / min ₹5,000 |
| "Give a discount for big orders" | ❌ Clear validation error |

**Design**: The LLM output is always run through `validateRule()` before being accepted — the LLM proposes, the validation gate decides. This means even if the model hallucinates a bad value, it will be caught and shown as an error to the user. The UI also shows a loading state ("Sending to Gemini…") while the API call is in flight.

**Note**: Since this is a back-office tool, the API key is embedded client-side. For a public-facing product, the call would be proxied through a secure backend endpoint.

### PDF upload

PDF parsing uses **PDF.js v4.10.38** loaded from a version-pinned CDN. It:
- Groups positioned text items by their vertical coordinate to reconstruct table rows
- Searches for a header row matching `Product | Brand | Platform | Base Price`
- Validates each data row through `validateItem`
- Reports malformed rows to the user without crashing

### What I did not add (and why)

- **No database**: State lives in memory. The assignment is a calculator, not a persistence layer.
- **No backend server**: All logic runs client-side. The only external dependency is PDF.js from a CDN.
- **No framework**: Vanilla JS + CSS keeps the bundle at zero dependencies and the deploy as a static folder copy.

---

## 📁 Project structure

```
src/
  engine.js       ← pure discount logic (no UI)
  parsers.js      ← CSV, PDF, NL parsing + validation
  app.js          ← UI wiring + state
  index.html      ← semantic HTML with unique IDs
  styles.css      ← design system with tokens + animations
tests/
  engine.test.mjs ← 15+ automated tests (Node test runner)
sample-data/
  cart.csv         ← sample cart (6 items)
  rules.csv        ← sample rules (4 rules)
build.mjs         ← static site builder (copies src → dist)
```

---

## 📊 Sample results (verified by tests)

| Item | Final price |
|---|---|
| ITEM-01 Cushion Cover | Rs.1,104 |
| ITEM-02 Bed Sheet Set | Rs.629 |
| ITEM-03 Wall Shelf | Rs.509 |
| ITEM-04 Ceramic Vase | Rs.2,499 |
| ITEM-05 Cutting Board | Rs.382 |
| ITEM-06 Desk Organiser | Rs.809 |
| **Cart subtotal** | **Rs.5,932** |
| **Cart offer saving** | **Rs.593** |
| **Final total** | **Rs.5,339** |
