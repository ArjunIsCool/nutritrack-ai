const BARCODE_LENGTHS = new Set([8, 12, 13, 14]);

export function normalizeRetailBarcode(input) {
  const value = String(input ?? "").replace(/[\s-]/g, "");
  if (!/^\d+$/.test(value) || !BARCODE_LENGTHS.has(value.length)) return null;
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
    vitamin_a_ug_rae: fromGToUg("vitamin-a_100g"),
    vitamin_c_mg: fromGToMg("vitamin-c_100g"),
    vitamin_d_ug: fromGToUg("vitamin-d_100g"),
    vitamin_e_mg: fromGToMg("vitamin-e_100g"),
    vitamin_k_ug: fromGToUg("vitamin-k_100g"),
    vitamin_b1_mg: fromGToMg("vitamin-b1_100g"),
    vitamin_b2_mg: fromGToMg("vitamin-b2_100g"),
    vitamin_b3_mg: fromGToMg("vitamin-b3_100g"),
    vitamin_b5_mg: fromGToMg("vitamin-b5_100g"),
    vitamin_b6_mg: fromGToMg("vitamin-b6_100g"),
    vitamin_b7_ug: fromGToUg("vitamin-b7_100g"),
    vitamin_b9_ug_dfe: fromGToUg("vitamin-b9_100g"),
    vitamin_b12_ug: fromGToUg("vitamin-b12_100g"),
    water_g: number("water_100g"),
    caffeine_mg: fromGToMg("caffeine_100g"),
    alcohol_g: null,
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
    imageUrl: typeof product.image_front_small_url === "string" && product.image_front_small_url.startsWith("https://") ? product.image_front_small_url : null,
    nutrients,
    basis: "per-100g",
    source: "Open Food Facts",
    sourceUrl: "https://world.openfoodfacts.org/product/" + encodeURIComponent(barcode),
    retrievedAt,
    confidence: "catalogue-match",
    warning: "Community-contributed catalogue data. Check the package label; missing values are unknown, not zero.",
  };
}


const USDA_NUTRIENT_MAP = {
  "208": ["energy_kcal", "kcal"], "203": ["protein_g", "g"],
  "205": ["carbohydrate_g", "g"], "204": ["total_fat_g", "g"],
  "606": ["saturated_fat_g", "g"], "605": ["trans_fat_g", "g"],
  "645": ["monounsaturated_fat_g", "g"], "646": ["polyunsaturated_fat_g", "g"],
  "601": ["cholesterol_mg", "mg"], "291": ["fiber_g", "g"],
  "269": ["total_sugars_g", "g"], "539": ["added_sugars_g", "g"],
  "307": ["sodium_mg", "mg"], "306": ["potassium_mg", "mg"],
  "301": ["calcium_mg", "mg"], "303": ["iron_mg", "mg"],
  "304": ["magnesium_mg", "mg"], "309": ["zinc_mg", "mg"],
  "305": ["phosphorus_mg", "mg"], "317": ["selenium_ug", "µg"],
  "312": ["copper_mg", "mg"], "315": ["manganese_mg", "mg"],
  "373": ["iodine_ug", "µg"], "421": ["choline_mg", "mg"],
  "320": ["vitamin_a_ug_rae", "µg"], "401": ["vitamin_c_mg", "mg"],
  "328": ["vitamin_d_ug", "µg"], "323": ["vitamin_e_mg", "mg"],
  "430": ["vitamin_k_ug", "µg"], "404": ["vitamin_b1_mg", "mg"],
  "405": ["vitamin_b2_mg", "mg"], "406": ["vitamin_b3_mg", "mg"],
  "410": ["vitamin_b5_mg", "mg"], "415": ["vitamin_b6_mg", "mg"],
  "416": ["vitamin_b7_ug", "µg"], "417": ["vitamin_b9_ug_dfe", "µg"],
  "418": ["vitamin_b12_ug", "µg"], "255": ["water_g", "g"],
  "262": ["caffeine_mg", "mg"], "221": ["alcohol_g", "g"],
};

function convertFdcAmount(amount, sourceUnit, targetUnit) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) return null;
  const source = String(sourceUnit || "").toLowerCase().replace("μ", "µ").replace("ug", "µg");
  if (targetUnit === "kcal") {
    if (source === "kcal" || source === "kcal/100g") return value;
    if (source === "kj" || source === "kj/100g") return value / 4.184;
    return null;
  }
  if (source === targetUnit) return value;
  if (targetUnit === "g") return source === "mg" ? value / 1000 : source === "µg" ? value / 1_000_000 : null;
  if (targetUnit === "mg") return source === "g" ? value * 1000 : source === "µg" ? value / 1000 : null;
  if (targetUnit === "µg") return source === "g" ? value * 1_000_000 : source === "mg" ? value * 1000 : null;
  return null;
}

export function normalizeUsdaFood(food, barcode, retrievedAt = new Date().toISOString()) {
  if (!food || typeof food !== "object" || !food.fdcId || !food.gtinUpc) return null;
  const canonical = value => String(value || "").replace(/\\D/g, "").replace(/^0+/, "");
  if (canonical(food.gtinUpc) !== canonical(barcode)) return null;
  const values = {
    energy_kcal: null, protein_g: null, carbohydrate_g: null, total_fat_g: null,
    saturated_fat_g: null, trans_fat_g: null, monounsaturated_fat_g: null,
    polyunsaturated_fat_g: null, cholesterol_mg: null, fiber_g: null,
    total_sugars_g: null, added_sugars_g: null, sodium_mg: null, potassium_mg: null,
    calcium_mg: null, iron_mg: null, magnesium_mg: null, zinc_mg: null,
    phosphorus_mg: null, selenium_ug: null, copper_mg: null, manganese_mg: null,
    iodine_ug: null, choline_mg: null, vitamin_a_ug_rae: null, vitamin_c_mg: null,
    vitamin_d_ug: null, vitamin_e_mg: null, vitamin_k_ug: null, vitamin_b1_mg: null,
    vitamin_b2_mg: null, vitamin_b3_mg: null, vitamin_b5_mg: null, vitamin_b6_mg: null,
    vitamin_b7_ug: null, vitamin_b9_ug_dfe: null, vitamin_b12_ug: null,
    water_g: null, caffeine_mg: null, alcohol_g: null,
  };
  for (const entry of Array.isArray(food.foodNutrients) ? food.foodNutrients : []) {
    const nutrient = entry?.nutrient || {};
    const mapped = USDA_NUTRIENT_MAP[String(nutrient.number || "")];
    if (!mapped) continue;
    const [key, unit] = mapped;
    if (values[key] !== null) continue;
    values[key] = convertFdcAmount(entry.amount, nutrient.unitName, unit);
  }
  const name = String(food.description || "").trim();
  if (!name) return null;
  return {
    barcode,
    name,
    brand: String(food.brandOwner || food.brandName || "").slice(0, 180),
    quantity: food.servingSize && food.servingSizeUnit ? String(food.servingSize) + " " + String(food.servingSizeUnit) + " serving" : "",
    categories: String(food.brandedFoodCategory || "").slice(0, 300),
    market: ["US"],
    imageUrl: null,
    nutrients: values,
    basis: "per-100g",
    source: "USDA FoodData Central (branded label data)",
    sourceUrl: "https://fdc.nal.usda.gov/food/" + encodeURIComponent(food.fdcId) + "/nutrients",
    retrievedAt,
    confidence: "exact-gtin-match",
    warning: "Branded nutrient data are supplied by data providers and may reflect package labels. Check the current physical package.",
  };
}
