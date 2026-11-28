import test from 'node:test';
import assert from 'node:assert/strict';
import { createNutritionSnapshot, normalizeNutrients, NUTRITION_SCHEMA_VERSION, NUTRIENTS } from '../src/nutritionSchema.js';
import { COUNTRIES, DEFAULT_COUNTRY_CODE } from '../src/countries.js';

test('country selector contains unique ISO-style country codes and India default', () => {
  const codes = COUNTRIES.map((country) => country.code);
  assert.ok(codes.includes('IN'));
  assert.equal(DEFAULT_COUNTRY_CODE, 'IN');
  assert.equal(new Set(codes).size, codes.length);
  assert.ok(codes.every((code) => /^[A-Z]{2}$/.test(code)));
});

test('nutrition schema includes comprehensive macro, mineral and vitamin fields', () => {
  const keys = NUTRIENTS.map(([key]) => key);
  for (const key of ['energy_kcal', 'protein_g', 'fiber_g', 'sodium_mg', 'iron_mg', 'vitamin_c_mg', 'vitamin_b12_ug']) {
    assert.ok(keys.includes(key), key);
  }
});

test('unknown nutrients remain null and are marked unavailable', () => {
  const normalized = normalizeNutrients({ energy_kcal: 125, vitamin_b12_ug: null });
  assert.equal(normalized.energy_kcal.value, 125);
  assert.equal(normalized.energy_kcal.status, 'estimated');
  assert.equal(normalized.energy_kcal.unit, 'kcal');
  assert.equal(normalized.vitamin_b12_ug.value, null);
  assert.equal(normalized.vitamin_b12_ug.status, 'unavailable');
  assert.equal(normalized.iron_mg.value, null);
});

test('invalid negative and non-finite values are not accepted as nutrition facts', () => {
  const normalized = normalizeNutrients({ sodium_mg: -5, calcium_mg: 'not-a-number', potassium_mg: Infinity });
  assert.equal(normalized.sodium_mg.value, null);
  assert.equal(normalized.calcium_mg.value, null);
  assert.equal(normalized.potassium_mg.value, null);
});

test('sourced values retain explicit provenance and basis', () => {
  const normalized = normalizeNutrients({
    iron_mg: { value: 2.4, status: 'sourced', source: 'food-composition-db', basis: 'per-100g' },
  });
  assert.equal(normalized.iron_mg.value, 2.4);
  assert.equal(normalized.iron_mg.status, 'sourced');
  assert.equal(normalized.iron_mg.source, 'food-composition-db');
  assert.equal(normalized.iron_mg.basis, 'per-100g');
});

test('nutrition snapshots are versioned and timestamped', () => {
  const snapshot = createNutritionSnapshot({ energy_kcal: 300 }, { recordedAt: '2026-11-28T00:00:00.000Z' });
  assert.equal(snapshot.schemaVersion, NUTRITION_SCHEMA_VERSION);
  assert.equal(snapshot.nutrients.energy_kcal.value, 300);
  assert.equal(snapshot.recordedAt, '2026-11-28T00:00:00.000Z');
});
