# OTWORKER Backend

Backend REST API for the OTWORKER overtime tracker app. This implementation uses plain Node.js plus Supabase Auth + Database, so the API stays simple while profile data lives in Supabase instead of browser storage or MongoDB.

## Features

- Current-user profile routes under `/api/profiles/me`
- Account-first current-user lookup by authenticated `authUserId`
- Backward-compatible profile CRUD by `username`
- Employee and `selectedMonth` update
- OT entry CRUD backed by a dedicated `otworker_entries` table
- Active timer start / view / update / stop
- Admin-only Excel export for all member OT profiles and entries
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
4. Start the server:

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
- Ownership rule: profile routes only allow the authenticated owner whose `sub` matches the stored `authUserId`; profiles with app `role = ADMIN` can read other accounts' OT data
- Admin export rule: profiles with app `role = ADMIN` can download the full OT workbook for all members
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

### Admin

- `GET /api/admin/members`
- `GET /api/admin/members/:username`
- `GET /api/admin/ot-data`
- `GET /api/admin/ot-export`

`GET /api/admin/members` requires `Authorization: Bearer <Supabase access_token>` for a profile whose app `role` is `ADMIN`. It returns a lightweight member list for FE dropdowns:

```json
{
  "members": [
    {
      "username": "huu-trong",
      "role": "ADMIN",
      "selectedMonth": "2026-05",
      "employee": {
        "label": "HUU",
        "employeeCode": "001",
        "fullName": "Dong Huu Trong",
        "sheetName": "Huu Trong"
      }
    }
  ]
}
```

`GET /api/admin/members/:username` uses `username` as the lookup key and returns one lightweight member profile:

```json
{
  "member": {
    "username": "huu-trong",
    "role": "ADMIN",
    "selectedMonth": "2026-05",
    "employee": {
      "label": "HUU",
      "employeeCode": "001",
      "fullName": "Dong Huu Trong",
      "sheetName": "Huu Trong"
    }
  }
}
```

`GET /api/admin/ot-data` returns all member OT data as JSON so FE can build its own workbook. Add `?month=YYYY-MM` to only include entries in one month:

```json
{
  "month": "2026-05",
  "profiles": [
    {
      "username": "huu-trong",
      "role": "ADMIN",
      "selectedMonth": "2026-05",
      "employee": {
        "label": "HUU",
        "employeeCode": "001",
        "fullName": "Dong Huu Trong",
        "sheetName": "Huu Trong"
      },
      "activeTimer": null,
      "entries": [
        {
          "id": "ot-example",
          "date": "2026-05-24",
          "startTime": "19:30",
          "endTime": "22:00",
          "note": "OT task"
        }
      ]
    }
  ]
}
```

`GET /api/admin/ot-export` requires `Authorization: Bearer <Supabase access_token>` for a profile whose app `role` is `ADMIN`. The response is an Excel workbook download:

```http
Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
Content-Disposition: attachment; filename="otworker-ot-export-YYYY-MM-DD.xlsx"
```

The workbook contains one worksheet per member. Each worksheet follows the FE `.xlsx` export format: columns A-I, member employee fields, OT date/time columns, total-hour formula, and explanation note. Overnight OT rows are split before export, for example `22:00 -> 01:30` becomes `22:00 -> 24:00` on the original date and `00:00 -> 01:30` on the next date.

## Data Shape

Each row in the `otworker_profiles` table stores one profile with `authUserId`, app `role`, `employee`, and `activeTimer`. The app role defaults to `USER`; set it to `ADMIN` in the database when an account needs read-only access to other accounts' OT data and the all-member Excel export. OT entries now live in a separate `otworker_entries` table keyed by `profile_id`, so entry listing and mutation no longer require rewriting an entire profile row. Public API responses do not expose `authUserId`. The `/api/profiles/me*` routes read and update by the authenticated account's `authUserId`, while `username` routes are kept for backward compatibility.

## Supabase Schema

Run the SQL in [supabase/otworker_profiles.sql](/d:/Workspace/WorkSpace/AI/OTWORKERBE/supabase/otworker_profiles.sql:1) inside the Supabase SQL Editor before starting the backend. It creates:

- the `otworker_profiles` and `otworker_entries` tables
- a `role` column on profiles with default `USER` and allowed values `USER` / `ADMIN`
- triggers to maintain `updated_at`
- a migration step that backfills legacy embedded `entries` into `otworker_entries`
- RLS policies so users can access their own rows, while app admins can read other accounts' profile and entry rows

## Smoke Test

```bash
npm run test:smoke
```

The smoke test now targets Supabase. Provide one of these before running it:

- `TEST_SUPABASE_ACCESS_TOKEN`: recommended, runs through the real authenticated-user flow
- `SUPABASE_SERVICE_ROLE_KEY`: recommended for admin-style smoke testing without a user token
