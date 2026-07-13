# Reverse-engineering report — "System Kół Łowieckich PZŁ 2.0"

Source artifact: `System+Kół+Łowieckich+PZŁ+2.0_1.1.1_APKPure.xapk`
Package: `com.smallgis.pzl` (iOS `pl.pzl.mobileapp`) · version `1.1.1` (build 699) · vendor **SmallGIS** for **Polski Związek Łowiecki (PZŁ)**.

This document captures everything recovered from the shipped binary. Our reimplementation (`pzl-client`) is built directly from it.

## 1. How it was built (confirmed from the binary)

Extracted `assets/app.config`, `assets/index.android.bundle` (Hermes bytecode v96, decompiled with `hermes-dec`) and the APK manifest.

- **Expo SDK 54** managed workflow, `newArchEnabled: true`, React Native new architecture (Fabric/TurboModules).
- **Expo Router** file-based routing with typed routes. Route groups: `(app)/(tabs)/(menu)/(modules)/…`.
- **Hermes** JS engine (bytecode shipped, not plain JS).
- **State/data:** TanStack **React Query** (mutation/query keys everywhere) + **Zod** schemas (`…RequestSchema`, `…ResponseSchema`, `…PathParamsSchema`) → the API layer is clearly generated from an **OpenAPI** spec (orval/openapi-codegen style).
- **UI:** **react-native-paper** (Material Design 3) + reanimated + gesture-handler + safe-area-context.
- **Maps:** **`@maplibre/maplibre-react-native`** with Polish government WMS/WMTS layers.
- **Native modules:** expo-location (+ background), expo-camera, expo-image-picker, expo-document-picker, expo-notifications (FCM), expo-secure-store, ML Kit barcode scanning, biometrics.
- **Monitoring:** Sentry (`o447951.ingest.sentry.io`, project `4509632503087104`).
- **Auth:** OIDC / OAuth2 Authorization-Code + **PKCE**.

Brand palette (from `app.config`): primary green `#2f6b26`, notification/accent `#2E7D32`, splash light `#96d784` / dark `#15520f`, adaptive-icon background `#2f6b26`, status bar `#96d784`.

## 2. Backend

| Purpose | Host |
|---|---|
| REST API | `https://api.systemkl2.pzlow.pl` |
| Auth (OIDC) | `https://auth.systemkl2.pzlow.pl` |
| Geo / GIS | `https://geo.systemkl2.pzlow.pl` |
| Map tile proxy | `https://api.systemkl2.pzlow.pl/maps/proxy` |
| Web app | `https://systemkl2.pzlow.pl` |

### OIDC config (from the decompiled `authConfig`)
- Authorization endpoint: `…/oauth2/authorize`
- Token endpoint: `…/oauth2/token`
- Userinfo endpoint: `…/userinfo` · End-session: `…/connect/logout`
- `client_id`: **`pzl-mobile-client`** (native) / `pzl-web-client` (web app)
- `redirect_uri`: **`pzl://signed-in`** — `makeRedirectUri({ path: 'signed-in' })`
  (verified against the server: `pzl://signed-in` → `/login` = registered;
  `pzl://auth` is **not** registered). Web app uses `https://systemkl2.pzlow.pl/auth`.
- `response_type`: `code`, `code_challenge_method`: `S256` (PKCE)
- `scope`: **`openid profile email`**

### Login flow (traced in the bundle)
expo-auth-session `useAuthRequest`/`promptAsync` opens the system browser →
user authenticates at `/login` → server redirects to `pzl://signed-in?code=…` →
`exchangeCodeAsync` POSTs to `/oauth2/token` with the PKCE verifier → tokens
saved to **expo-secure-store** (`AUTH_KEYS.ACCESS_TOKEN/REFRESH_TOKEN/ID_TOKEN`,
`WHEN_UNLOCKED`). An **axios request interceptor** attaches
`Authorization: Bearer <token>`; a **response interceptor** refreshes on `401`
via the refresh token (skipping `/oauth2/token`, single-flight `isRefreshing`).
An optional local **PIN + biometric** lock (`PinAuthProvider`/`usePinAuth`)
gates the UI over the stored session.

### HTTP verb distribution in the client
GET ≈ 2352, POST ≈ 451, PUT ≈ 363, DELETE ≈ 166, PATCH ≈ 28 — a large read-heavy CRUD surface (~2000 distinct path literals).

## 3. Data scoping

Almost every business endpoint is scoped to a **hunting-club unit**:

```
/units/{unit-id}/<resource>/...
```

So the app flow is: authenticate → pick/act within a `unit` (koło łowieckie / OHZ / zarząd okręgowy) → use module resources.

## 4. Feature modules (the `/units/{unit-id}` resource tree)

Recovered sub-resources (each is roughly one product module):

- `annual-hunting-plans` — roczne plany łowieckie (+ execution-plan, documents)
- `multi-year-plans` — wieloletnie plany łowieckie
- `collective-huntings` (+ `collective-hunting-settlements`) — polowania zbiorowe i ich rozliczenia
- `huntings` / `hunting-settlements` / `hunting-financial-settlements` / `hunting-settlements-ekep` — polowania indywidualne i rozliczenia
- `electronic-hunting-book` / `low1` / `low1-attach` — elektroniczna książka ewidencji polowań (LOW-1)
- `material-book` — książka materiałowa
- `hunting-damages` (+ `hunting-damage` details) — szkody łowieckie
- `game-breeding-centers` — ośrodki hodowli zwierzyny (OHZ)
- `board-meetings` / `board-protocols` / `management-resolution(-gen)` / `management-announcements` — posiedzenia i uchwały zarządu
- `district-board-reports` (ASF weekly) — raporty zarządów okręgowych / ASF
- `economic-activity-plans` / `economic-activity-protocols` — działalność gospodarcza
- `authorizations` (issue/extend/block/return/reserve/generate-document…) — upoważnienia do wykonywania polowania (odstrzały)
- `hunting-detailed-acquisition(-sanitary)` — szczegółowe pozyskanie / odstrzał sanitarny
- `hunting-assessment-sheets` — arkusze oceny (wyceny trofeów)
- `hunting-events`, `hunting-districts`, `hunting-tools`, `hunting-stations/stands`, `hunting-devices`
- `finances` / `club-finances` / `deposits` / `pzl-finances` / `contracts-leases` — finanse
- `hunters` / `hunters-list` / `hunter-invited` / `hunter-localization` / `trainees` / `beaters` / `candidates` / `applications` / `role-applications` — ludzie i wnioski
- `persons` / `personal-data` / `users`
- `messages` / `inbox` / `sms` / `sms-configuration` / `email` / `news` / `management-announcements` — komunikacja
- `documents-templates`, `legal-acts`, `journal`, `audit`, `inventories`, `ksef`, `zipod`, `help-desk`
- Cross-cutting: `dictionaries/*` (animal-type, counties, countries, voivodeship, nationalities, profession, education, measurement-unit, years, helps …)

### Example endpoint families
```
GET    /units/{unit-id}/collective-huntings
POST   /units/{unit-id}/collective-huntings
GET    /collective-huntings/map
POST   /collective-huntings:approve   /collective-huntings:cancel
GET    /units/{unit-id}/collective-hunting-settlements   .../balance   .../to-settle
GET    /units/{unit-id}/annual-hunting-plans   .../execution-plan   .../execution-plan/document
GET    /units/{unit-id}/hunting-damages
POST   /authorizations:issue :extend :block :cross-out :return :reserve :generate-document
GET    /dictionaries/{name}   /dictionaries/{name}/full
GET    /district-board-reports/asf-weekly/summaries/all/district-boards
```
(`:verb` = RPC-style action suffix used by the backend.)

## 5. Navigation shell

Bottom tabs (recovered route segments + Polish titles): **Mapa** (`map`), **Menu** (`menu` → module list), **Komunikacja/Wiadomości** (`communication`), **Powiadomienia** (`notifications`), **Profil** (`profile`). `Start` is the initial/dashboard label.

Router groups: `(app)/(tabs)/(menu)/(modules)/<module>` — the menu tab lists modules, each opening a module stack.

## 6. Map layers (Polish government GIS — WMS/WMTS)

Recovered layer sources:
- **Ortofotomapa** (orthophoto), WMTS: `https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMTS/StandardResolution`
- **BDOT10k** topographic WMS: `https://mapy.geoportal.gov.pl/wss/service/pub/guest/kompozycja_BDOT10k_WMS/MapServer/WMSServer`
- **Lasy Państwowe / BDL** (State Forests) WMS: `https://mapserver.bdl.lasy.gov.pl/ArcGIS/services/WMS_BDL/mapserver/WMSServer`
- **Ewidencja gruntów (cadastre) KIEG** WMS: `https://integracja01.gugik.gov.pl/cgi-bin/KrajowaIntegracjaEwidencjiGruntow/wss/service/pub/guest/G2_GO_WMS/MapServer/WMSServer`
- Plus app-owned vector layers via `geo.systemkl2.pzlow.pl` and the `maps/proxy` (hunting districts, collective-hunting stands, etc.).

## 7. Reimplementation strategy

The original is a full ERP for Polish hunting-club administration — far larger than one client can be exhaustively rebuilt. `pzl-client` faithfully reproduces the **architecture** and builds the core end-to-end, so the rest slots in mechanically:

1. Same stack: Expo SDK 54 + Expo Router + React Query + Paper + MapLibre, targeting **iOS, Android and Web** from one codebase.
2. Real **OIDC/PKCE** auth against `auth.systemkl2.pzlow.pl` via `expo-auth-session` (works on native and web).
3. Typed **API client** + generated **endpoint catalog** + React Query hooks mirroring the reversed routes.
4. Navigation shell with the reversed tab + module structure.
5. **Map** screen with the real Polish WMS/WMTS layers (native via `@maplibre/maplibre-react-native`, web via `maplibre-gl`).
6. Two feature modules built fully (Collective Huntings, Hunting Damages) as the template; the module registry lists the rest.

Recovered raw artifacts live in `docs/` (`api-endpoints.txt`).
