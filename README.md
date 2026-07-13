# PZŁ Client — custom web + mobile client for Koła Łowieckie

A clean-room React Native (Expo) reimplementation of the **"System Kół Łowieckich PZŁ 2.0"** app, built by reverse-engineering the shipped `.xapk`. One codebase runs on **iOS, Android and the Web**.

> Full reverse-engineering write-up: [`REVERSE_ENGINEERING.md`](./REVERSE_ENGINEERING.md).
> Raw recovered endpoint list: [`docs/api-endpoints.txt`](./docs/api-endpoints.txt).

## Why rebuild it

The original is an Expo/Hermes app whose JS is shipped as bytecode. We recovered its architecture, backend, OIDC config, navigation and ~2000 API routes, then rebuilt a leaner client on the same stack so it talks to the same backend (`*.systemkl2.pzlow.pl`).

## Stack

- **Expo SDK 54** + **Expo Router** (file-based routing, typed routes) — same as the original.
- **React Query** for server state, **Zod** for response validation.
- **react-native-paper** (Material 3) themed in the PZŁ green palette (`#2f6b26`).
- **MapLibre** — `@maplibre/maplibre-react-native` on native, `maplibre-gl` on web — sharing one style built from the recovered Polish government WMS/WMTS layers.
- **expo-auth-session** OIDC Authorization-Code + PKCE against `auth.systemkl2.pzlow.pl`.
- **expo-secure-store** for tokens on native, `localStorage` on web.

## Project layout

```
app/                         # Expo Router screens
  _layout.tsx                # providers + root stack
  index.tsx                  # auth gate → login or app
  login.tsx                  # OIDC sign-in
  (app)/
    _layout.tsx              # auth guard
    hunting-signup.tsx       # sign self / another hunter onto a hunt (modal)
    (tabs)/                  # Mapa · Polowania · Plan · Profil
      map.tsx                # unified map: local settings + cached geo overlays
      hunting-book.tsx       # "kto poluje" — live hunts, sign-up, end
      plan.tsx               # annual plan realization
      profile.tsx            # account, units, → Więcej modułów
      (menu)/                # secondary module grid
        (modules)/           # feature modules (collective-huntings, hunting-damages, …)
src/
  config.ts                  # recovered backend URLs + OIDC config
  api/                       # fetch client + endpoint catalog
  auth/                      # persistent OIDC provider + secure token store
  offline/                   # query persistence, connectivity, queued mutations
  units/                     # active hunting-club (unit) context
  features/
    huntingBook/             # active hunts + sign-up/end (offline) + lookups
    plan/                    # annual plan execution
    map/                     # local settings, cached geo layers, offline packs
  map/                       # layers, style builder, platform map components
  theme/  components/  providers/
```

## Running

```bash
npm install
npm run web        # browser
npm run ios        # iOS simulator (needs a dev build for MapLibre)
npm run android    # Android emulator
npm run typecheck
```

> MapLibre and secure-store are native modules, so device/simulator runs need an Expo **dev build** (`npx expo run:ios` / `run:android`), not Expo Go. Web runs anywhere.

## Auth notes

`client_id` (`pzl-mobile-client`), redirect (`pzl://auth`) and the `/oauth2/*` endpoints were recovered from the binary. Sign-in works if the PZŁ authorization server accepts this client for our redirect URIs (native `pzl://auth`, web `<origin>/auth`). If it is locked to the official app, point `extra.*` in `app.json` at a staging IdP.

## Primary screens (the three core flows)

The bottom tabs are **Mapa · Polowania · Plan · Profil**. The three core screens:

1. **Polowania — "Kto poluje"** (`app/(app)/(tabs)/hunting-book.tsx`)
   Live list of who is currently hunting (individual-hunting / LOW-1 entries), with
   **sign myself up**, **sign another hunter up** (`app/(app)/hunting-signup.tsx`),
   and **end a hunt**. Backed by `/units/{id}/huntings` + `/electronic-hunting-book/forms/solo-sign-up`.
   Works offline: sign-up/end apply optimistically to the local list and are queued,
   then flushed automatically on reconnect. Data age is shown at the top.

2. **Plan — realizacja** (`app/(app)/(tabs)/plan.tsx`)
   Annual hunting plan completion from `/units/{id}/annual-hunting-plans/execution-plan`:
   overall % plus per-species **plan vs. pozyskano vs. pozostało** progress bars
   (`target` / `done` / `remainingToHarvest`). Cached, readable offline, shows data age.

3. **Mapa** (`app/(app)/(tabs)/map.tsx`)
   One unified map. Base layer, raster overlays, which club data to draw
   (**obwody/rewiry**, dzierżawy, urządzenia łowieckie, ambony), and the district
   filter are **all saved locally** (`src/features/map/settings.ts`) and restored on
   launch. The club GeoJSON is cached (`src/features/map/geo.ts`) so districts/devices
   draw with no connection. Camera position is persisted. On mobile, "Zapisz obszar
   offline" downloads the base tiles for the current area (`src/features/map/offline.native.ts`).

## Offline-first & auth (built for use in the woods)

- **Login is permanent.** After the one login screen, credentials live in secure
  storage forever — no PIN, never asked again. The app opens straight into the map
  even with no signal. Token refresh happens silently in the background (on a timer,
  on foreground, and on reconnect); a network failure never logs you out — only a
  server-side token revocation does. See `src/auth/AuthProvider.tsx`.
- **Data survives offline.** The whole React Query cache is persisted to AsyncStorage
  (`src/offline/queryClient.ts`), so the last-known hunts, plan and map data are there
  on next launch. NetInfo drives React Query's `onlineManager`
  (`src/offline/connectivity.ts`) so reads/writes pause offline and auto-resume.
- **Queued writes.** Offline sign-up/end mutations are persisted as paused mutations
  and resumed on reconnect (`src/offline/mutationDefaults.ts` + `AppProviders`).
- **Age of data** is surfaced on every data screen via `<DataAge>`
  (`src/components/offline.tsx`), plus an offline banner and per-item "oczekuje na
  wysłanie" markers.

## Secondary modules

The broader module menu (plans, authorizations, finances, damages, board meetings…)
is reachable from **Profil → Więcej modułów**. Collective Huntings and Hunting Damages
are built out; the rest are scaffolded over their recovered endpoints as fill-in
templates (`src/features/*/api.ts`).
