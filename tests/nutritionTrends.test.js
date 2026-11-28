import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateNutrientTrend } from '../src/nutritionTrends.js';

test('coverage-aware aggregation excludes unknown values instead of treating them as zero', () => {
  const result = aggregateNutrientTrend([
    { date: '2026-11-28', nutrition: { nutrients: { sodium_mg: { value: 400 } } } },
    { date: '2026-11-28', nutrition: { nutrients: { sodium_mg: { value: null } } } },
    { date: '2026-11-28' },
  ], 'sodium_mg');
  assert.equal(result.length, 1);
  assert.equal(result[0].mealCount, 3);
  assert.equal(result[0].knownMeals, 1);
  assert.equal(result[0].observedTotal, 400);
  assert.equal(result[0].coverage, 1 / 3);
});

test('legacy macro values remain available for backward compatibility', () => {
  const result = aggregateNutrientTrend([
    { date: '2026-11-27', calories: 500 },
    { date: '2026-11-27', calories: null },
  ], 'energy_kcal');
  assert.equal(result[0].observedTotal, 500);
  assert.equal(result[0].coverage, 0.5);
});

test('weekly buckets start on Monday and monthly buckets use calendar months', () => {
  const meals = [
    { date: '2026-11-23', nutrition: { nutrients: { fiber_g: { value: 5 } } } },
    { date: '2026-11-28', nutrition: { nutrients: { fiber_g: { value: 3 } } } },
    { date: '2026-12-01', nutrition: { nutrients: { fiber_g: { value: 2 } } } },
  ];
  const weekly = aggregateNutrientTrend(meals, 'fiber_g', 'weekly');
  assert.equal(weekly.length, 2);
  assert.equal(weekly[0].period, '2026-11-23');
  assert.equal(weekly[0].observedTotal, 8);
  const monthly = aggregateNutrientTrend(meals, 'fiber_g', 'monthly');
  assert.deepEqual(monthly.map(item => item.period), ['2026-11', '2026-12']);
});
