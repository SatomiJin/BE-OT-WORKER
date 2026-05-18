# OTWORKER Backend

Backend REST API for the OTWORKER overtime tracker app. This implementation uses plain Node.js plus Supabase Auth + Database, so the API stays simple while profile data lives in Supabase instead of browser storage or MongoDB.

## Features

- Current-user profile routes under `/api/profiles/me`
- Account-first current-user lookup by authenticated `authUserId`
- Backward-compatible profile CRUD by `username`
- Employee and `selectedMonth` update
- OT entry CRUD backed by a dedicated `otworker_entries` table
- Active timer start / view / update / stop
- Supabase persistence so data survives browser cache clears
- Leaner profile and timer reads so large OT histories do not bloat every response
- Input validation and conflict responses
- CORS configuration by environment variable

## Requirements

- Node.js 22+

## Run Local

1. Copy `.env.example` to `.env`.
2. Fill in `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
3. Create the database table and RLS policies from [supabase/otworker_profiles.sql](/d:/Workspace/WorkSpace/AI/OTWORKERBE/supabase/otworker_profiles.sql:1).
3. Start the server:

```bash
npm start
```

Server default:

- Base URL: `http://localhost:3000`
- Health check: `GET /health`

## Environment Variables

- `PORT`: HTTP port. Default `3000`
- `APP_TIME_ZONE`: Business timezone for deriving entry `date`, `startTime`, and `endTime`. Default `Asia/Ho_Chi_Minh`
- `CORS_ORIGIN`: Allowed origin for browser requests. Default `http://localhost:3026`
- `SUPABASE_URL`: Required. Your Supabase project URL.
- `SUPABASE_ANON_KEY`: Required. Used together with the authenticated user's access token so queries run under RLS.
- `SUPABASE_SERVICE_ROLE_KEY`: Optional but recommended. Lets the backend enforce ownership itself and keeps `403`/`404` behavior precise.
- `SUPABASE_TABLE_NAME`: Optional. Default `otworker_profiles`.
- `SUPABASE_ENTRIES_TABLE_NAME`: Optional. Default `otworker_entries`.
- `SUPABASE_JWT_VERIFY`: Set to `true` to require `Authorization: Bearer <access_token>` on `/api/*`.
- `SUPABASE_JWT_AUDIENCE`: Optional audience claim to enforce.
- `SUPABASE_JWT_ISSUER`: Optional issuer override. Default is `<SUPABASE_URL>/auth/v1`.
- `MAX_REQUEST_BODY_BYTES`: Optional request body limit. Default `65536`.

## Authentication

When `SUPABASE_JWT_VERIFY=true`, the backend verifies Supabase access tokens locally using the project's JWKS endpoint instead of calling `supabase.auth.getUser()` on every request.

- Protected routes: all `/api/*` endpoints
- Public route: `GET /health`
- Required header: `Authorization: Bearer <Supabase access_token>`
- Claims made available to the server: `sub`, `email`, `role`
- Ownership rule: profile routes only allow the authenticated owner whose `sub` matches the stored `authUserId`
- Database access path:
  If `SUPABASE_SERVICE_ROLE_KEY` is set, the backend uses it for database queries and enforces ownership in application code.
  Otherwise, the backend falls back to `SUPABASE_ANON_KEY` plus the same bearer token so Supabase RLS applies to the signed-in user.

This flow assumes your Supabase project is using asymmetric signing keys so the JWKS endpoint returns public verification keys.

## API Summary

### Profiles

- `GET /api/me`
- `GET /api/profiles/me`
- `POST /api/profiles/me/init`
- `PUT /api/profiles/me`
- `POST /api/profiles`
- `GET /api/profiles/:username`
- `PUT /api/profiles/:username`
- `DELETE /api/profiles/:username`

### Entries

- `POST /api/profiles/me/entries`
- `PUT /api/profiles/me/entries/:entryId`
- `DELETE /api/profiles/me/entries/:entryId`
- `GET /api/profiles/:username/entries?month=YYYY-MM`
- `POST /api/profiles/:username/entries`
- `PUT /api/profiles/:username/entries/:entryId`
- `DELETE /api/profiles/:username/entries/:entryId`

### Timer

- `POST /api/profiles/me/timer/start`
- `PUT /api/profiles/me/timer`
- `POST /api/profiles/me/timer/stop`
- `POST /api/profiles/:username/timer/start`
- `GET /api/profiles/:username/timer`
- `PUT /api/profiles/:username/timer`
- `POST /api/profiles/:username/timer/stop`

## Data Shape

Each row in the `otworker_profiles` table stores one profile with `authUserId`, `employee`, and `activeTimer`. OT entries now live in a separate `otworker_entries` table keyed by `profile_id`, so entry listing and mutation no longer require rewriting an entire profile row. Public API responses do not expose `authUserId`. The `/api/profiles/me*` routes read and update by the authenticated account's `authUserId`, while `username` routes are kept for backward compatibility.

## Supabase Schema

Run the SQL in [supabase/otworker_profiles.sql](/d:/Workspace/WorkSpace/AI/OTWORKERBE/supabase/otworker_profiles.sql:1) inside the Supabase SQL Editor before starting the backend. It creates:

- the `otworker_profiles` and `otworker_entries` tables
- triggers to maintain `updated_at`
- a migration step that backfills legacy embedded `entries` into `otworker_entries`
- RLS policies so users can only access rows where `auth.uid() = auth_user_id`

## Smoke Test

```bash
npm run test:smoke
```

The smoke test now targets Supabase. Provide one of these before running it:

- `TEST_SUPABASE_ACCESS_TOKEN`: recommended, runs through the real authenticated-user flow
- `SUPABASE_SERVICE_ROLE_KEY`: recommended for admin-style smoke testing without a user token
