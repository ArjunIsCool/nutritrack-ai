export const NUTRITION_SCHEMA_VERSION = 1;

export const NUTRIENTS = [
  ['energy_kcal', 'Energy', 'kcal', 'energy'],
  ['protein_g', 'Protein', 'g', 'macros'],
  ['carbohydrate_g', 'Carbohydrate', 'g', 'macros'],
  ['total_fat_g', 'Total fat', 'g', 'macros'],
  ['saturated_fat_g', 'Saturated fat', 'g', 'fats'],
  ['trans_fat_g', 'Trans fat', 'g', 'fats'],
  ['monounsaturated_fat_g', 'Monounsaturated fat', 'g', 'fats'],
  ['polyunsaturated_fat_g', 'Polyunsaturated fat', 'g', 'fats'],
  ['cholesterol_mg', 'Cholesterol', 'mg', 'fats'],
  ['fiber_g', 'Dietary fibre', 'g', 'carbohydrates'],
  ['total_sugars_g', 'Total sugars', 'g', 'carbohydrates'],
  ['added_sugars_g', 'Added sugars', 'g', 'carbohydrates'],
  ['sodium_mg', 'Sodium', 'mg', 'minerals'],
  ['potassium_mg', 'Potassium', 'mg', 'minerals'],
  ['calcium_mg', 'Calcium', 'mg', 'minerals'],
  ['iron_mg', 'Iron', 'mg', 'minerals'],
  ['magnesium_mg', 'Magnesium', 'mg', 'minerals'],
  ['zinc_mg', 'Zinc', 'mg', 'minerals'],
  ['phosphorus_mg', 'Phosphorus', 'mg', 'minerals'],
  ['selenium_ug', 'Selenium', 'µg', 'minerals'],
  ['copper_mg', 'Copper', 'mg', 'minerals'],
  ['manganese_mg', 'Manganese', 'mg', 'minerals'],
  ['iodine_ug', 'Iodine', 'µg', 'minerals'],
  ['choline_mg', 'Choline', 'mg', 'vitamins'],
  ['vitamin_a_ug_rae', 'Vitamin A', 'µg RAE', 'vitamins'],
  ['vitamin_c_mg', 'Vitamin C', 'mg', 'vitamins'],
  ['vitamin_d_ug', 'Vitamin D', 'µg', 'vitamins'],
  ['vitamin_e_mg', 'Vitamin E', 'mg', 'vitamins'],
  ['vitamin_k_ug', 'Vitamin K', 'µg', 'vitamins'],
  ['vitamin_b1_mg', 'Vitamin B1 (thiamin)', 'mg', 'vitamins'],
  ['vitamin_b2_mg', 'Vitamin B2 (riboflavin)', 'mg', 'vitamins'],
  ['vitamin_b3_mg', 'Vitamin B3 (niacin)', 'mg', 'vitamins'],
  ['vitamin_b5_mg', 'Vitamin B5 (pantothenic acid)', 'mg', 'vitamins'],
  ['vitamin_b6_mg', 'Vitamin B6', 'mg', 'vitamins'],
  ['vitamin_b7_ug', 'Vitamin B7 (biotin)', 'µg', 'vitamins'],
  ['vitamin_b9_ug_dfe', 'Vitamin B9 (folate)', 'µg DFE', 'vitamins'],
  ['vitamin_b12_ug', 'Vitamin B12', 'µg', 'vitamins'],
  ['water_g', 'Water', 'g', 'other'],
  ['caffeine_mg', 'Caffeine', 'mg', 'other'],
  ['alcohol_g', 'Alcohol', 'g', 'other'],
];

export function normalizeNutrients(values, options = {}) {
  const defaultStatus = options.status || 'estimated';
  const defaultSource = options.source || 'gemini';
  const basis = options.basis || 'whole-meal';
  const input = values && typeof values === 'object' ? values : {};

  return Object.fromEntries(NUTRIENTS.map(([key, label, unit, group]) => {
    const raw = input[key];
    const rawValue = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw.value : raw;
    const numeric = rawValue === null || rawValue === undefined || rawValue === ''
      ? null
      : Number(rawValue);
    const valid = numeric !== null && Number.isFinite(numeric) && numeric >= 0;
    const status = valid
      ? (raw && typeof raw === 'object' && ['sourced', 'user-entered', 'estimated'].includes(raw.status) ? raw.status : defaultStatus)
      : 'unavailable';
    return [key, {
      label,
      value: valid ? numeric : null,
      unit,
      group,
      basis: raw && typeof raw === 'object' && raw.basis ? String(raw.basis) : basis,
      status,
      source: valid ? (raw && typeof raw === 'object' && raw.source ? String(raw.source) : defaultSource) : null,
    }];
  }));
}

export function createNutritionSnapshot(values, options = {}) {
  return {
    schemaVersion: NUTRITION_SCHEMA_VERSION,
    basis: options.basis || 'whole-meal',
    nutrients: normalizeNutrients(values, options),
    recordedAt: options.recordedAt || new Date().toISOString(),
  };
}

export function nutrientValue(snapshot, key) {
  const value = snapshot?.nutrients?.[key]?.value;
  return Number.isFinite(value) ? value : null;
}
