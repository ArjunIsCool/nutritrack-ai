# NutriTrack AI — Privacy Policy (Draft)

**Draft for legal review.** Replace all bracketed placeholders and verify the actual provider configuration, retention and data locations before publishing.

**Effective date:** [DATE]  
**Operator:** [LEGAL NAME / BUSINESS NAME]  
**Privacy contact:** [PRIVACY EMAIL]  
**Address:** [REGISTERED BUSINESS ADDRESS]

## 1. Scope

This policy explains how [LEGAL NAME] handles information when you use NutriTrack AI (the "Service"). It should be read with the Terms of Service. This draft is not ready for publication until reviewed and completed.

## 2. Information processed

Depending on your use, the Service may process:

- **Account details:** Firebase user identifier, email address, display name and authentication/session metadata from Google sign-in.
- **Nutrition profile:** age, height, weight, target weight, activity level, goals and preferences you enter.
- **Nutrition records:** meal descriptions, food items, portion information, estimated calories and nutrients, meal history and weight history you choose to save.
- **AI requests:** meal text and selected category sent when you request an analysis, and the generated estimate.
- **Subscription records:** plan, subscription identifiers, entitlement status and payment-verification events. Razorpay processes checkout; the Service is not intended to store full card numbers or CVV.
- **Technical information:** request timestamps, service logs, error/security events and basic browser/device information processed by hosting providers.

Nutrition and weight information may be sensitive personal information. Do not submit information you are not comfortable having processed.

## 3. Purposes

We use information to authenticate you, store and synchronize your account, provide nutrition estimates you request, manage subscriptions, enforce usage limits, protect the Service, troubleshoot errors, respond to support requests and comply with law.

## 4. Providers and disclosures

The Service currently uses or is designed to use:

- Google Firebase Authentication and Cloud Firestore for sign-in and account data;
- Cloudflare Workers and D1 for backend APIs, usage limits and entitlement records;
- Google Gemini API to process meal descriptions when you request AI analysis;
- Razorpay to process subscription checkout and payment events.

These providers process information under their own terms and privacy documentation. Depending on provider infrastructure and configuration, data may be processed outside your state or country. Confirm actual data locations, contractual terms and cross-border transfer obligations before publication.

We do not sell personal information. We may disclose information where required by law, to protect users or the Service, or in a business transfer subject to applicable law.

## 5. AI and nutrition estimates

Meal descriptions are sent to Google Gemini when you request an analysis. Generated nutrition values are estimates and may be inaccurate. Review portions and assumptions. The Service does not provide medical diagnosis or treatment and is not a substitute for a qualified health professional.

## 6. Retention and deletion

Account data is retained while needed to provide the Service. Settings includes an account deletion control intended to delete the Firebase sign-in account, Firestore profile and meal records, and related D1 usage/entitlement records, while cancelling a linked Razorpay subscription.

Some technical logs, payment records, backups or records required for security, accounting, disputes or legal compliance may remain for periods determined by provider policies or applicable law. Verify actual backup and log retention periods before publication.

## 7. Choices and rights

Subject to applicable law, you may have rights to access, correct or delete personal information and other rights depending on your location. Settings provides a JSON data export and account deletion controls. Contact [PRIVACY EMAIL] for privacy requests.

## 8. Security

We use authentication, access rules and server-side controls designed to protect account information. No online service can guarantee absolute security. Keep your Google account secure.

## 9. Children

The Service is not intended for children under [MINIMUM AGE]. Complete this age threshold and any age assurance process after legal review. Contact [PRIVACY EMAIL] if you believe a child has provided information contrary to this policy.

## 10. Changes and contact

We may update this policy and revise the effective date. Where required, we will provide notice.

[LEGAL NAME / BUSINESS NAME]  
[REGISTERED BUSINESS ADDRESS]  
[PRIVACY EMAIL]
