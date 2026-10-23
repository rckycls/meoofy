# PawPin Product and System Design

**Date:** 2026-10-23  
**Status:** Design approved in conversation; written specification awaiting review  
**Initial platforms:** iOS and web  
**Initial market:** Global availability  
**Operating budget target:** US$200 per month during development and early launch

## 1. Purpose

PawPin helps reunite lost dogs and cats with their owners while keeping pet ownership and personal information private during normal daily life.

An owner privately registers a pet and supplies reference photos. If the pet goes missing, the owner enables Discovery Mode and publishes a missing-pet alert. A finder can photograph the animal without first creating an account. PawPin searches only discoverable pets and returns either one strong possible match, a private review path, or no reliable match. The finder must verify an account before messaging the owner or sharing an exact location.

PawPin treats visual matching as decision support. It never claims that an image proves identity.

## 2. Product goals

- Provide private registration for dogs and cats.
- Make reporting a pet missing fast and reversible.
- Include photo matching in the first public release.
- Let a finder perform an initial scan without an account.
- Protect owner identity, contact details, and exact locations.
- Notify participating users near a missing pet while preserving notification control.
- Offer the complete lost-pet recovery flow on every subscription tier.
- Support global availability without assuming equal local community coverage.
- Keep early operating costs near US$200 per month.

## 3. Non-goals for the first release

- A public directory of pets or owners.
- A conclusive biometric identity claim.
- Veterinary diagnosis, medical records management, or emergency medical advice.
- Ownership adjudication or proof of legal ownership.
- Custom model training before existing models and services are evaluated.
- Android-native distribution. The responsive web app remains accessible from Android browsers.
- Guaranteed recovery or guaranteed local alert coverage.

## 4. Users and permissions

### Owner

An authenticated user who creates pet records, manages reference photos, controls Discovery Mode, publishes missing alerts, receives sightings, communicates with finders, and closes recovery cases.

### Finder

Anyone can submit an initial pet scan. An authenticated and verified account is required to message an owner, submit an exact location, or maintain a sighting history.

### Nearby participant

An authenticated user who has enabled missing-pet notifications for selected species and geographic areas.

### Operator

A restricted administrative role used for abuse reports, account support, model evaluation, system health, and audit review. Operator access is logged and follows least privilege.

## 5. Core recovery journey

1. The owner creates a private dog or cat profile and supplies required reference photos.
2. PawPin checks image quality and creates an identification profile.
3. When the pet is lost, the owner reports it missing, supplies last-seen details, reviews the recovery profile, and confirms publication.
4. PawPin enables Discovery Mode, creates an alert, and notifies eligible nearby participants.
5. A finder photographs the animal. An account is not required for this initial scan.
6. PawPin compares the scan only with currently discoverable pets.
7. PawPin returns one of three outcomes: strong possible match, uncertain/private review, or no reliable match.
8. The finder verifies an account before messaging the owner or sharing an exact found location.
9. The owner marks the pet safe. PawPin disables Discovery Mode, closes the alert, stops new notifications, and preserves an owner-visible recovery history.

## 6. Pet and recovery states

A pet has an independent registration state and recovery state.

- **Private:** Registered and excluded from all finder searches.
- **Missing:** Discovery enabled, recovery profile published, and eligible for matching and alerts.
- **Recovered:** Active alert closed and discovery disabled. The pet returns to Private.
- **Archived:** Retained for the owner but inactive. It cannot be matched or reported missing until restored.

Server-side authorization controls every state transition. Clients cannot make a private pet searchable by directly changing local state.

## 7. Identification design

### Enrollment

Owners provide several reference images covering the face, left and right profiles, full body, coat pattern, and distinctive markings when present. Automated quality checks reject images that are too dark, blurred, obstructed, too distant, or inconsistent with the selected species.

Registration photos are stored privately. Derived matching representations are associated with the private pet identifier. Only representations belonging to Missing pets enter the searchable index.

### Finder scan

The scan experience requests multiple views when practical. PawPin validates image quality, estimates species, creates image representations, and searches the active species-specific discovery index. Location and time affect ranking but do not hard-exclude candidates because lost animals can travel.

Evidence is combined across submitted images. One image cannot override contradictory evidence from the others.

### Outcomes

- **Strong possible match:** PawPin shows one pet and only the owner-approved recovery information. The interface says “possible match,” never “identity confirmed.”
- **Uncertain:** PawPin reveals no pet or owner identity. It can invite the finder to verify an account and allow PawPin to notify candidate owners for private review.
- **No reliable match:** PawPin reveals no registry information and offers a generic sighting submission.

Thresholds are versioned, species-specific, and set from evaluation evidence. Model version, threshold version, response time, and non-identifying decision metadata are recorded for monitoring and rollback.

## 8. Matching validation and launch gates

Reference images and evaluation images must come from different sessions. Evaluation varies lighting, angle, distance, background, device, and time. It includes similar-looking animals and animals absent from the registry.

Dogs and cats are reported separately. Required measures include:

- Precision for results labeled Strong possible match.
- Recall for accepted-quality scans of registered discoverable pets.
- False-positive rate for unregistered pets.
- Rejection rate caused by image quality.
- Median and high-percentile response time.
- Infrastructure cost per completed scan.

Enabling the Strong possible match outcome requires at least 99% measured precision and at least 70% recall on accepted-quality scans for each species. Samples must be large and varied enough to make the measurement meaningful; the evaluation report must include confidence intervals and known coverage gaps. Failure to meet this gate does not remove photo matching from the first release. It restricts matching to uncertain/private-review and no-reliable-match outcomes until the gate is met.

PawPin does not advertise global identification accuracy based only on the initial local pilot.

## 9. Missing-pet alerts

PawPin explains the community benefit before requesting operating-system notification or location permission. The operating system controls final permission.

After permission, preferences default to dogs and cats within 5 km. Users can change radius, select species, mute alerts temporarily, or disable them. Users can follow an approved current area or save areas without granting continuous background location.

A missing report produces one initial nearby notification. Updates are grouped and rate-limited. Reach may expand gradually up to the owner's selected maximum radius. Broad notifications slow over time, but Discovery Mode stays active until the owner closes the case.

Alerts expose an approximate last-seen area. Exact owner, home, and finder locations remain private. Verified sightings appear on a private owner timeline.

## 10. Secure contact

PawPin provides in-platform messaging between verified users. Personal phone numbers and email addresses remain hidden unless a user explicitly shares them. Exact finder location is shared only within the verified conversation and only after the finder confirms the action.

Users can block and report accounts. Rate limits, spam controls, and operator review protect messaging. Closing a recovery case prevents new finder conversations while preserving existing safety evidence according to the retention policy.

## 11. Privacy and data lifecycle

Private pet data and published recovery data have separate access rules. Enabling Discovery Mode creates a limited recovery projection containing only approved fields. Disabling Discovery Mode removes the pet from new searches immediately and closes the public alert.

Unauthenticated scans use short-lived identifiers. Raw images and derived representations for an unmatched, unsubmitted scan are deleted within 24 hours. A finder who explicitly submits a sighting consents to retain its images and location while the case is active and for 90 days after it closes, after which PawPin deletes them unless safety evidence must be preserved for a reported incident. These defaults are configurable by region when law requires a shorter or longer period, and the applicable period is shown before submission.

Owners can export account data, delete pets, delete their account, revoke sessions, and review important account and recovery actions. Sensitive actions—discovery changes, missing reports, contact disclosure, administrative access, and deletion—produce audit events.

Public launch requires a privacy and legal review covering international availability, location data, children, consent, deletion, image processing, subscription terms, and regional disclosure requirements.

## 12. Subscription model

| Tier | Active registered pets | Matching and recovery |
|---|---:|---|
| Free | 3 | Included |
| Pro | 10 | Included |
| Max | Unlimited | Included |

Finder scanning remains free. “Unlimited” means legitimate pet registration and remains subject to abuse prevention. Automated scanning, scraping, and excessive upload behavior are rate-limited on every tier.

If an account downgrades below its current pet count, all records remain private and preserved. The owner selects which profiles stay active. Any pet already in an active recovery case remains active until the case closes, regardless of payment state.

Retail prices are operational configuration rather than part of this system design. Store product identifiers and entitlements provide the application boundary, allowing prices and currencies to change without application releases.

## 13. Technical architecture

PawPin uses a shared React Native codebase through Expo for iOS and responsive web. Platform-specific modules are limited to camera behavior, push notifications, secure local storage, and subscription integration.

The application backend is a managed modular monolith with these internal modules:

- Identity and access.
- Pet registry and media.
- Recovery state and alerts.
- Finder scans and sightings.
- Messaging and reports.
- Subscription entitlements.
- Audit and operational metrics.

A relational database is the system of record. Managed object storage holds private images. Geographic indexes select eligible alerts. Authorization rules and recovery projections are enforced on the server.

Photo matching runs behind a narrow service interface: enroll reference images, activate or deactivate a searchable pet, evaluate a scan, and report model health. This service can use an external provider or a separately deployed model without changing product workflows. Raw private registry access is never exposed to clients or to the public web application.

Asynchronous jobs handle image processing, index updates, push notifications, retention deletion, and retries. User-visible state changes are recorded before jobs run, and the interface shows pending status when downstream work is incomplete.

## 14. Failure behavior

- Poor images receive actionable capture guidance and can be retaken.
- A matching timeout returns a retryable status; it never defaults to a match.
- If search-index activation fails, the owner sees that discovery setup is incomplete and alerts remain visible to the owner for repair.
- Notification failure does not close or hide the missing case.
- Duplicate taps and network retries are idempotent for missing reports, state changes, messages, and payments.
- A payment outage cannot terminate an active recovery case.
- Model or threshold regressions can be rolled back independently of the application release.
- Cost or abuse controls may slow new scans, but they never fabricate results or expose private candidates.

## 15. Cost controls

The early operating target is US$200 per month, excluding AI coding subscriptions. PawPin will:

- Resize and compress images before or immediately after upload.
- Retain originals only when product requirements justify them.
- Delete temporary scan data automatically.
- Compute matching only on demand and cache safe intermediate results.
- Batch and deduplicate notifications.
- Track cost per stored pet, scan, active alert, and message thread.
- Configure budget alerts and service-level spending limits.
- Avoid custom model training and dedicated GPU hosting unless evaluation proves them necessary.

Global availability is not a promise that US$200 supports unlimited adoption. Before usage approaches the budget ceiling, PawPin must either fund the added demand through subscriptions, reduce unit cost, or control new registrations. Active recovery cases remain protected from subscription and capacity changes.

## 16. Security and abuse controls

- Server-side authorization for every private record and state transition.
- Encryption in transit and managed encryption at rest.
- Signed, expiring media access.
- Rate limits by account, device, network signals, and action risk.
- Verification before messaging or exact-location sharing.
- Protection against enumeration: uncertain and no-match responses reveal no candidate count or private metadata.
- Logged administrative access with restricted roles.
- Reporting, blocking, evidence preservation, and appeal paths.
- Dependency, secret, backup, restore, and incident-response procedures before public launch.

## 17. Testing strategy

Automated tests cover authorization and privacy boundaries first. They also cover subscription limits, recovery transitions, search-index activation, alert targeting, message access, deletion, idempotency, and payment failure behavior.

Integration tests exercise image upload through matching response with a fixed evaluation fixture. End-to-end tests cover owner registration, missing report, unauthenticated scan, verification, secure contact, and recovery closure on iOS and web.

Operational tests verify queue retries, notification failures, expired links, storage cleanup, backup restoration, rollback, and budget alerts. Accessibility checks cover capture guidance, alerts, forms, messaging, and status announcements.

## 18. Delivery sequence

1. **Identification feasibility:** collect consented dog and cat images, compare candidate matching approaches, measure baseline accuracy and unit cost, and choose the matching service implementation.
2. **Private registry:** implement accounts, pet profiles, media, enrollment quality checks, subscription entitlements, and deletion.
3. **Recovery path:** implement missing state, discovery projection, finder scan, confidence outcomes, sightings, secure messaging, and recovery closure.
4. **Nearby network:** implement notification permission flow, saved areas, geographic targeting, preferences, throttling, and expansion.
5. **Operational readiness:** implement abuse response, audit access, retention, backups, cost dashboards, privacy controls, and store subscriptions.
6. **Invitation pilot:** test the full journey with controlled participants, validate costs and support workflows, and repair gaps.
7. **Global public release:** release iOS and web when privacy review, reliability checks, budget controls, and the matching release mode justified by species-specific evaluation all pass.

This document defines the complete first-release product boundary. Implementation planning is split by delivery phase so each plan remains reviewable. The first implementation plan covers Identification feasibility only; later phases receive their own plan after the preceding evidence is reviewed.

## 19. Success criteria

- An owner can register a dog or cat and keep it undiscoverable.
- An owner can report a pet missing and publish only reviewed recovery information.
- A finder can complete an initial scan without an account.
- Private pets never appear in matching results.
- Strong-match results meet the species-specific precision gate.
- A verified finder and owner can communicate without exposing personal contact details.
- Marking a pet safe removes it from new searches and stops new alerts.
- Users can control alert radius, species, muting, and opt-out.
- Subscription failure never interrupts an active recovery case.
- Temporary scan data is removed according to policy.
- Early usage stays observable and controllable against the US$200 monthly target.
