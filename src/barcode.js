const BARCODE_LENGTHS = new Set([8, 12, 13, 14]);

export function normalizeRetailBarcode(input) {
  const value = String(input ?? "").replace(/[\\s-]/g, "");
  if (!/^\\d+$/.test(value) || !BARCODE_LENGTHS.has(value.length)) return null;
  const digits = value.split("").map(Number);
  const checkDigit = digits.pop();
  let sum = 0;
  // GS1 Mod-10: weights alternate 3 and 1 from the rightmost data digit.
  for (let index = digits.length - 1, weight = 3; index >= 0; index--, weight = weight === 3 ? 1 : 3) {
    sum += digits[index] * weight;
  }
  return (10 - (sum % 10)) % 10 === checkDigit ? value : null;
}

export function normalizeOpenFoodFactsProduct(product, barcode, retrievedAt = new Date().toISOString()) {
  if (!product || typeof product !== "object") return null;
  const nutriments = product.nutriments && typeof product.nutriments === "object" ? product.nutriments : {};
  const number = (...keys) => {
    for (const key of keys) {
      const value = nutriments[key];
      if (value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) && Number(value) >= 0) return Number(value);
    }
    return null;
  };
  const fromGToMg = (...keys) => {
    const value = number(...keys);
    return value === null ? null : value * 1000;
  };
  const fromGToUg = (...keys) => {
    const value = number(...keys);
    return value === null ? null : value * 1_000_000;
  };
  const energyKcal = number("energy-kcal_100g", "energy-kcal_value");
  const energyKj = number("energy-kj_100g", "energy-kj_value");
  const nutrients = {
    energy_kcal: energyKcal ?? (energyKj === null ? null : energyKj / 4.184),
    protein_g: number("proteins_100g"),
    carbohydrate_g: number("carbohydrates_100g"),
    total_fat_g: number("fat_100g"),
    saturated_fat_g: number("saturated-fat_100g"),
    trans_fat_g: number("trans-fat_100g"),
    monounsaturated_fat_g: number("monounsaturated-fat_100g"),
    polyunsaturated_fat_g: number("polyunsaturated-fat_100g"),
    cholesterol_mg: fromGToMg("cholesterol_100g"),
    fiber_g: number("fiber_100g"),
    total_sugars_g: number("sugars_100g"),
    added_sugars_g: number("added-sugars_100g"),
    sodium_mg: fromGToMg("sodium_100g"),
    potassium_mg: fromGToMg("potassium_100g"),
    calcium_mg: fromGToMg("calcium_100g"),
    iron_mg: fromGToMg("iron_100g"),
    magnesium_mg: fromGToMg("magnesium_100g"),
    zinc_mg: fromGToMg("zinc_100g"),
    phosphorus_mg: fromGToMg("phosphorus_100g"),
    selenium_ug: fromGToUg("selenium_100g"),
    copper_mg: fromGToMg("copper_100g"),
    manganese_mg: fromGToMg("manganese_100g"),
    iodine_ug: fromGToUg("iodine_100g"),
    vitamin_a_ug_rae: number("vitamin-a_100g"),
    vitamin_c_mg: number("vitamin-c_100g"),
    vitamin_d_ug: number("vitamin-d_100g"),
    vitamin_e_mg: number("vitamin-e_100g"),
    vitamin_k_ug: number("vitamin-k_100g"),
    vitamin_b1_mg: number("vitamin-b1_100g"),
    vitamin_b2_mg: number("vitamin-b2_100g"),
    vitamin_b3_mg: number("vitamin-b3_100g"),
    vitamin_b5_mg: number("vitamin-b5_100g"),
    vitamin_b6_mg: number("vitamin-b6_100g"),
    vitamin_b7_ug: number("vitamin-b7_100g"),
    vitamin_b9_ug_dfe: number("vitamin-b9_100g"),
    vitamin_b12_ug: number("vitamin-b12_100g"),
    water_g: number("water_100g"),
    caffeine_mg: null,
    alcohol_g: number("alcohol_100g"),
  };
  const name = String(product.product_name || product.product_name_en || "").trim();
  if (!name) return null;
  return {
    barcode,
    name,
    brand: String(product.brands || "").slice(0, 180),
    quantity: String(product.quantity || "").slice(0, 120),
    categories: String(product.categories || "").slice(0, 300),
    market: Array.isArray(product.countries_tags) ? product.countries_tags : [],
    imageUrl: typeof product.image_front_small_url === "string" && /^https:\\/\\//i.test(product.image_front_small_url) ? product.image_front_small_url : null,
    nutrients,
    basis: "per-100g",
    source: "Open Food Facts",
    sourceUrl: "https://world.openfoodfacts.org/product/" + encodeURIComponent(barcode),
    retrievedAt,
    confidence: "catalogue-match",
    warning: "Community-contributed catalogue data. Check the package label; missing values are unknown, not zero.",
  };
}
