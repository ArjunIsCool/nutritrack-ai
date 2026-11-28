import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRetailBarcode, normalizeOpenFoodFactsProduct, normalizeUsdaFood } from '../src/barcode.js';

test('validates EAN-8, UPC-A and EAN-13 check digits', () => {
  assert.equal(normalizeRetailBarcode('96385074'), '96385074');
  assert.equal(normalizeRetailBarcode('036000291452'), '036000291452');
  assert.equal(normalizeRetailBarcode('4006381333931'), '4006381333931');
  assert.equal(normalizeRetailBarcode('00036000291452'), '00036000291452');
  assert.equal(normalizeRetailBarcode('4006381333932'), null);
});

test('rejects unsupported lengths, non-digits and malformed input', () => {
  for (const value of ['', '123', '123456789', 'abc4006381333931', '4006-3813-33932']) {
    assert.equal(normalizeRetailBarcode(value), null);
  }
});

test('normalizes product facts to explicit per-100g units and preserves missing values', () => {
  const result = normalizeOpenFoodFactsProduct({
    product_name: 'Example oats',
    brands: 'Example',
    quantity: '500 g',
    nutriments: { 'energy-kcal_100g': 370, proteins_100g: 13, 'sodium_100g': 0.01, 'vitamin-c_100g': 0.01, 'vitamin-b12_100g': 0.000002 }
  }, '4006381333931', '2026-11-28T00:00:00.000Z');
  assert.equal(result.name, 'Example oats');
  assert.equal(result.nutrients.energy_kcal, 370);
  assert.equal(result.nutrients.protein_g, 13);
  assert.equal(result.nutrients.sodium_mg, 10);
  assert.equal(result.nutrients.vitamin_c_mg, 10);
  assert.equal(result.nutrients.vitamin_b12_ug, 2);
  assert.equal(result.nutrients.iron_mg, null);
  assert.equal(result.basis, 'per-100g');
  assert.equal(result.source, 'Open Food Facts');
  assert.equal(result.retrievedAt, '2026-11-28T00:00:00.000Z');
});

test('uses energy conversion only when kcal is absent and rejects nameless products', () => {
  const result = normalizeOpenFoodFactsProduct({ product_name: 'Rice', nutriments: { 'energy-kj_100g': 4184 } }, '4006381333931');
  assert.equal(result.nutrients.energy_kcal, 1000);
  assert.equal(normalizeOpenFoodFactsProduct({ nutriments: {} }, '4006381333931'), null);
});

test('USDA branded records require exact GTIN match and preserve per-100g provenance', () => {
  const product = normalizeUsdaFood({
    fdcId: 123456,
    gtinUpc: '00036000291452',
    description: 'USDA branded cereal',
    brandOwner: 'Example Foods',
    publicationDate: '2026-01-15',
    foodNutrients: [
      { nutrient: { number: '208', name: 'Energy', unitName: 'kcal' }, amount: 250 },
      { nutrient: { number: '203', name: 'Protein', unitName: 'g' }, amount: 8 },
      { nutrient: { number: '307', name: 'Sodium, Na', unitName: 'mg' }, amount: 120 },
      { nutrient: { number: '418', name: 'Vitamin B-12', unitName: 'µg' }, amount: 0.8 },
    ],
  }, '036000291452', '2026-11-28T00:00:00.000Z');
  assert.equal(product.name, 'USDA branded cereal');
  assert.equal(product.nutrients.energy_kcal, 250);
  assert.equal(product.nutrients.protein_g, 8);
  assert.equal(product.nutrients.sodium_mg, 120);
  assert.equal(product.nutrients.vitamin_b12_ug, 0.8);
  assert.equal(product.source, 'USDA FoodData Central (branded label data)');
  assert.equal(product.confidence, 'exact-gtin-match');
  assert.equal(normalizeUsdaFood({ fdcId: 1, gtinUpc: '012345678905', description: 'Wrong product' }, '036000291452'), null);
});
