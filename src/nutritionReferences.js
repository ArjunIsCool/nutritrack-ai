const ICMR_INDIA_ADULT = {
  male: {
    fiber_g: { sedentary: 30, moderate: 40, heavy: 50 },
    iron_mg: 19, vitamin_b12_ug: 2.2, vitamin_c_mg: 80,
  },
  female: {
    fiber_g: { sedentary: 25, moderate: 30, heavy: 40 },
    iron_mg: 29, vitamin_b12_ug: 2.2, vitamin_c_mg: 65,
  },
};

export function getNutritionReference(nutrientKey, profile = {}) {
  const age = Number(profile.age);
  if (nutrientKey === "sodium_mg" && Number.isFinite(age) && age >= 18) {
    return {
      value: 2000, unit: "mg/day", kind: "upper-limit",
      label: "WHO adult recommendation: less than 2,000 mg/day",
      source: "World Health Organization",
      sourceUrl: "https://www.who.int/news-room/fact-sheets/detail/sodium-reduction",
    };
  }
  const sex = String(profile.sex || "").toLowerCase();
  const country = String(profile.countryCode || "").toUpperCase();
  if (country !== "IN" || age < 18 || age > 60 || !ICMR_INDIA_ADULT[sex]) return null;
  const activity = profile.activity === "high" ? "heavy" : profile.activity === "moderate" ? "moderate" : "sedentary";
  const values = ICMR_INDIA_ADULT[sex];
  const value = nutrientKey === "fiber_g" ? values.fiber_g[activity] : values[nutrientKey];
  if (!Number.isFinite(value)) return null;
  const units = { fiber_g: "g/day", iron_mg: "mg/day", vitamin_b12_ug: "µg/day", vitamin_c_mg: "mg/day" };
  return {
    value, unit: units[nutrientKey], kind: "rda-ai",
    label: "ICMR–NIN 2020 adult reference (" + activity + " work category)",
    source: "ICMR–NIN, Nutrient Requirements for Indians (2020), summary of RDA",
    sourceUrl: "https://www.fssai.gov.in/upload/advisories/2021/08/6109077a384adDirection_RDA_02_08_2021.pdf",
  };
}
