import { parseRuleText } from '../src/parsers.js';

const tests = [
  '20% off for Natura Casa brand, stackable with other offers',
  'Rs.100 flat discount on all Flipkart items',
  '10% off if cart value is more than Rs.5,000',
  'Give a discount for big orders',
];

for (const input of tests) {
  console.log(`\nInput: "${input}"`);
  const result = await parseRuleText(input);
  console.log('Result:', JSON.stringify(result, null, 2));
}
