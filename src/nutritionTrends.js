const LEGACY_FIELDS = {
  energy_kcal: "calories",
  protein_g: "protein",
  carbohydrate_g: "carbs",
  total_fat_g: "fat",
  fiber_g: "fiber",
  total_sugars_g: "sugar",
};

function periodKey(date, period) {
  if (period === "monthly") return date.slice(0, 7);
  if (period === "weekly") {
    const parsed = new Date(date + "T00:00:00Z");
    const day = (parsed.getUTCDay() + 6) % 7;
    parsed.setUTCDate(parsed.getUTCDate() - day);
    return parsed.toISOString().slice(0, 10);
  }
  return date;
}

export function aggregateNutrientTrend(meals, nutrientKey, period = "daily") {
  const groups = new Map();
  for (const meal of Array.isArray(meals) ? meals : []) {
    const date = typeof meal?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(meal.date) ? meal.date : null;
    if (!date) continue;
    const key = periodKey(date, period);
    if (!groups.has(key)) groups.set(key, { period: key, mealCount: 0, knownMeals: 0, observedTotal: 0 });
    const group = groups.get(key);
    group.mealCount += 1;
    let raw = meal?.nutrition?.nutrients?.[nutrientKey]?.value;
    if (raw === undefined && LEGACY_FIELDS[nutrientKey]) raw = meal?.[LEGACY_FIELDS[nutrientKey]];
    const value = raw === null || raw === undefined || raw === "" ? null : Number(raw);
    if (value !== null && Number.isFinite(value) && value >= 0) {
      group.knownMeals += 1;
      group.observedTotal += value;
    }
  }
  return [...groups.values()].sort((a, b) => a.period.localeCompare(b.period)).map(group => ({
    ...group,
    observedTotal: group.knownMeals ? group.observedTotal : null,
    coverage: group.mealCount ? group.knownMeals / group.mealCount : 0,
    averagePerKnownMeal: group.knownMeals ? group.observedTotal / group.knownMeals : null,
    label: period === "monthly" ? group.period : period === "weekly" ? "Week of " + group.period : group.period,
  }));
}
