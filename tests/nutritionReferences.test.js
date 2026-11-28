import test from 'node:test';
import assert from 'node:assert/strict';
import { getNutritionReference } from '../src/nutritionReferences.js';

test('WHO adult sodium upper limit is available regardless of country', () => {
  const result = getNutritionReference('sodium_mg', { age: 30, countryCode: 'IN' });
  assert.equal(result.value, 2000);
  assert.equal(result.kind, 'upper-limit');
  assert.match(result.sourceUrl, /who.int/);
});

test('ICMR India adult references depend on sex and activity category', () => {
  const male = getNutritionReference('fiber_g', { age: 25, sex: 'male', countryCode: 'IN', activity: 'moderate' });
  const female = getNutritionReference('iron_mg', { age: 25, sex: 'female', countryCode: 'IN' });
  assert.equal(male.value, 40);
  assert.equal(female.value, 29);
  assert.equal(getNutritionReference('vitamin_b12_ug', { age: 25, sex: 'male', countryCode: 'IN' }).value, 2.2);
});

test('National Academies references are available for supported US and Canada adult profiles', () => {
  assert.equal(getNutritionReference('fiber_g', { age: 25, sex: 'male', countryCode: 'US' }).value, 38);
  assert.equal(getNutritionReference('iron_mg', { age: 25, sex: 'female', countryCode: 'CA' }).value, 18);
  assert.equal(getNutritionReference('vitamin_c_mg', { age: 25, sex: 'female', countryCode: 'US' }).value, 75);
});

test('does not invent jurisdictional targets for unsupported countries or ages', () => {
  assert.equal(getNutritionReference('iron_mg', { age: 25, sex: 'male', countryCode: 'US' }), null);
  assert.equal(getNutritionReference('iron_mg', { age: 70, sex: 'male', countryCode: 'IN' }), null);
  assert.equal(getNutritionReference('added_sugars_g', { age: 25, sex: 'male', countryCode: 'IN' }), null);
});
