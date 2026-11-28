# Phase 4 — Product improvements

Status: approved to begin  
Working branch: `feature/global-nutrition-tracking`  
Base: `feature/session-revocation`  
Scope: global food logging, structured nutrition, durable meal records, and nutrition insights.

## Product goals

Phase 4 turns NutriTrack AI from a calorie/macro logger into a country-aware nutrition tracker. Existing account authentication, Firestore cloud sync, Worker-side Gemini proxy, D1 quotas, subscriptions, and session revocation must remain intact.

## Workstreams and acceptance criteria

### 4.1 Global profile context and food-photo analysis

- Add a required country selection to first-run profile setup; persist an ISO 3166-1 alpha-2 country code in the cloud profile.
- Allow changing country later in profile settings.
- Include the saved country in every relevant server-side analysis prompt. Do not hard-code India as the user's location.
- Photo analysis accepts a maximum of five attachments per analysis request, enforced in both UI and Worker.
- Allow an optional caption to accompany photo attachments.
- Show previews, attachment count, validation errors, and removal controls before submission.
- Validate file type, per-file size, aggregate request size, and actual attachment count before invoking Gemini.
- Do not silently drop attachments or exceed provider request limits. Return actionable validation errors.
- Preserve text-only meal analysis as a supported input path.

### 4.2 Barcode product identification

- Treat barcode scanning as a separate workflow from image-based meal analysis.
- Decode/validate UPC, EAN, and GTIN identifiers locally where practical; do not upload a barcode image to Gemini as the first step.
- Resolve identifiers through an ordered, documented source adapter strategy: GS1 data where accessible, manufacturer sources, relevant government/national food composition sources, then clearly labelled reputable secondary catalogues.
- Record product identifiers, market/country, source URL/name, retrieval time, match confidence, package size, serving basis, and provenance of nutrient values.
- Handle missing, ambiguous, conflicting, and stale product records explicitly. Never invent nutrition facts.
- AI may explain or interpret verified/retrieved product data, but must not overwrite sourced facts.

### 4.3 Standardized comprehensive nutrient model

- Establish one versioned nutrient schema shared by text, photo, and barcode entries.
- Include energy, macronutrients, fibre, total/added sugars, saturated/trans fats, mono/polyunsaturated fats, sodium, potassium, calcium, iron, magnesium, zinc, phosphorus, selenium, copper, manganese, iodine, vitamins A/C/D/E/K, B-complex vitamins (B1, B2, B3, B5, B6, B7, B9, B12), and other useful fields where reliable (e.g. cholesterol, water, caffeine, alcohol).
- Every nutrient value has an explicit unit, serving basis, and provenance/estimation status.
- Distinguish measured/database-sourced, AI-estimated, user-entered, and unavailable values.
- Unknown values are null/absent, never silently converted to zero.
- Store the schema version and preserve raw structured analysis snapshots so historical meals do not change when prompts/models/databases evolve.
- Do not present nutrient adequacy as a medical diagnosis. Reference targets must be appropriate to user characteristics and jurisdiction, with clear caveats.

### 4.4 Complete meal history

- Every saved meal opens a detail view with the complete saved analysis.
- Include itemized foods and portions, nutrient totals and per-item values, caption/prompt, attachment metadata/previews where retained, assumptions, clarification, assessment, date/time, source/provenance, and user corrections.
- Detail views read the saved snapshot; they must not re-run AI analysis.
- Ensure multi-device sync, export/import, deletion, and backup replacement preserve the full snapshot and attachments safely.
- Avoid storing huge base64 images directly in Firestore documents. Use a deliberate storage strategy, access rules, retention, and deletion behavior before enabling cloud image persistence.

### 4.5 Nutrition trends and insights

- Add daily/weekly/monthly views for available nutrients, not just calories and macros.
- Track sodium, sugars/added sugars, fibre, and vitamin/mineral intake where data coverage supports it.
- Aggregate partial nutrient coverage transparently; do not treat unknown values as zero.
- Use appropriate dietary reference values and show the reference jurisdiction, user assumptions, and limitations.
- Avoid medical claims or prescriptive diagnosis.

### 4.6 Onboarding and retention

- Explain country context and allow users to edit it later.
- Explain text, photo, and barcode logging separately.
- Explain estimated versus sourced nutrient data and how to review meal details.
- Keep onboarding concise and accessible.

## Engineering guardrails

- Preserve mandatory Firebase authentication and Firestore-backed cloud data.
- Keep Gemini credentials and provider integrations server-side; never add secrets to Vite client variables.
- Keep D1 quotas, demo rules, subscription entitlements, session revocation, and account deletion behavior intact.
- Enforce attachment count, payload size, allowed MIME types, and request limits on the server, not only in React.
- Use provider/source adapters for barcode lookup; avoid brittle scraping or claiming a source is official without evidence.
- Design image storage and lifecycle before accepting persistent user photos. Account deletion must cover any new storage objects.
- Add schema migration/backward-compatibility handling for existing meals and profiles.
- Add automated tests for schema normalization, limits, parsing, source matching, and aggregation. The repository currently has no test script; introduce a proportionate test setup.
- Never fabricate unavailable micronutrient values or reference targets.
- Keep Preview and Production data isolated before any production rollout; the current Wrangler configuration shares a D1 database.

## Delivery sequence

1. Inspect existing data contracts and add the country-aware profile + versioned nutrition schema foundation.
2. Implement comprehensive text-analysis output and persist full analysis snapshots; add meal detail history.
3. Implement photo attachments (maximum five), caption, secure validation, storage lifecycle, and image analysis.
4. Implement barcode decoding and source adapters with provenance and ambiguity handling.
5. Implement nutrient dashboards/trends with coverage-aware aggregation and reference targets.
6. Complete onboarding, migration/backups, regression tests, documentation, and staged preview validation.

## Definition of done

A signed-in user in any supported country can choose their country, log by text/photo/barcode, and save a durable structured meal record. A photo request cannot exceed five attachments. Barcode lookup begins with identifier resolution rather than Gemini image interpretation. Opening any saved meal displays its original complete analysis. Nutrient values expose units, basis, and provenance; missing data remains unknown. Existing account, billing, quota, cloud sync, deletion, and session security flows continue to work.
