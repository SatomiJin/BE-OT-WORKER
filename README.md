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
- User feedback submission plus an owner-only feedback inbox with email alerts
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
- `SUPABASE_FEEDBACK_TABLE_NAME`: Optional. Default `otworker_feedback`.
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

### Feedback

- `POST /api/feedback`
- `GET /api/feedback`

`POST /api/feedback` is the endpoint behind the FE "Góp ý" widget. Any authenticated account can call it, even before its profile has been initialized.

Request body:

```json
{
  "category": "bug",
  "message": "Xuất Excel bị sai ngày.",
  "context": {
    "username": "nguyen-van-a",
    "email": "a@example.com",
    "role": "USER",
    "page": "/"
  }
}
```

- `category`: one of `bug`, `idea`, `other`. Defaults to `other` when omitted.
- `message`: required, trimmed, at most 2000 characters (matches the FE textarea limit).
- `context`: optional object, or `null` when the user unchecks "Đính kèm thông tin kỹ thuật". Only known keys are stored (`username`, `email`, `displayName`, `role`, `page`, `userAgent`, `appVersion`, `language`, `platform`, `screen`, `timezone`, `selectedMonth`), each capped at 500 characters, so an oversized or unexpected payload cannot bloat the row.

Response `201`:

```json
{
  "feedback": {
    "id": "fb-mgk1x2-a1b2c3",
    "username": "nguyen-van-a",
    "category": "bug",
    "message": "Xuất Excel bị sai ngày.",
    "context": { "username": "nguyen-van-a" },
    "status": "NEW",
    "createdAt": "2026-09-07T04:15:00.000Z",
    "updatedAt": "2026-09-07T04:15:00.000Z"
  }
}
```

`GET /api/feedback` returns the caller's own submissions, newest first. Add `?limit=N` to cap the result count (default `50`, maximum `200`). The caller never sees `adminNote`.

### Admin

- `GET /api/admin/members`
- `GET /api/admin/members/:username`
- `GET /api/admin/ot-data`
- `GET /api/admin/ot-export`
- `GET /api/admin/feedback`
- `GET /api/admin/feedback/:id`
- `PUT /api/admin/feedback/:id`
- `DELETE /api/admin/feedback/:id`

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

`GET /api/admin/feedback` lists every submission, newest first, and includes `adminNote`. Filter with `?status=NEW|TRIAGED|RESOLVED|WONT_FIX`, `?category=bug|idea|other`, and `?limit=N`.

`PUT /api/admin/feedback/:id` triages one submission. Send `status`, `adminNote`, or both:

```json
{ "status": "RESOLVED", "adminNote": "Đã sửa ở bản deploy hôm nay." }
```

All four feedback inbox routes are restricted to a single account rather than to the `ADMIN` role, because feedback is addressed to one person. The recipient is `FEEDBACK_OWNER_USERNAME` in [src/server.js](src/server.js); `GET /api/me` reports `canReadFeedback` so the frontend can show the inbox tab without duplicating that rule. Handing the inbox to someone else means changing that constant, the matching `username` in `public.is_otworker_feedback_owner()`, and `FEEDBACK_OWNER_USERNAME` in the frontend's `public/app.js`.

## Data Shape

Each row in the `otworker_profiles` table stores one profile with `authUserId`, app `role`, `employee`, and `activeTimer`. The app role defaults to `USER`; set it to `ADMIN` in the database when an account needs read-only access to other accounts' OT data and the all-member Excel export. OT entries now live in a separate `otworker_entries` table keyed by `profile_id`, so entry listing and mutation no longer require rewriting an entire profile row. Public API responses do not expose `authUserId`. The `/api/profiles/me*` routes read and update by the authenticated account's `authUserId`, while `username` routes are kept for backward compatibility.

Feedback rows live in a separate `otworker_feedback` table holding the submitting account's `auth_user_id`, a nullable `profile_id` link, the `category` / `message` / `context` the user sent, plus the admin-side `status` and `admin_note`. Public feedback responses do not expose `authUserId` or `profileId`, and only admin responses include `adminNote`.

## Supabase Schema

Run the SQL in [supabase/otworker_profiles.sql](/d:/Workspace/WorkSpace/AI/OTWORKERBE/supabase/otworker_profiles.sql:1) inside the Supabase SQL Editor before starting the backend. It creates:

- the `otworker_profiles` and `otworker_entries` tables
- a `role` column on profiles with default `USER` and allowed values `USER` / `ADMIN`
- triggers to maintain `updated_at`
- a migration step that backfills legacy embedded `entries` into `otworker_entries`
- RLS policies so users can access their own rows, while app admins can read other accounts' profile and entry rows

Then run [supabase/otworker_feedback.sql](supabase/otworker_feedback.sql) to add the feedback channel. It creates:

- the `otworker_feedback` table with `category` and `status` check constraints
- indexes for the newest-first admin list and the per-user list
- an `updated_at` trigger
- RLS policies so a user reads and inserts only their own feedback, while the feedback owner can read, triage, and delete every row

Until this SQL is applied, the feedback routes answer `503` with a message naming the missing table instead of failing opaquely.

## Feedback Email Alerts

A new feedback row emails the owner through a Supabase Edge Function, so the backend needs no mail configuration and a mail outage can never block a submission.

1. Deploy the function:

   ```bash
   supabase functions deploy notify-feedback
   ```

2. Set its secrets. `FEEDBACK_ALERT_TO` accepts a comma-separated list:

   ```bash
   supabase secrets set RESEND_API_KEY=re_xxx
   supabase secrets set FEEDBACK_ALERT_TO=you@example.com
   supabase secrets set FEEDBACK_ALERT_FROM="OT Worker <feedback@yourdomain.com>"
   supabase secrets set FEEDBACK_WEBHOOK_SECRET=<a long random string>
   supabase secrets set FEEDBACK_APP_URL=https://fe-ot-worker.vercel.app
   ```

   `FEEDBACK_ALERT_FROM` and `FEEDBACK_APP_URL` are optional; without a verified domain, Resend's `onboarding@resend.dev` sender works for testing.

3. Edit [supabase/otworker_feedback_webhook.sql](supabase/otworker_feedback_webhook.sql), replacing `<PROJECT_REF>` and `<WEBHOOK_SECRET>` (the latter must equal `FEEDBACK_WEBHOOK_SECRET`), then run it in the SQL Editor.

The trigger fires `AFTER INSERT` via `pg_net`, so it never delays or fails the user's `POST /api/feedback`. If the secret does not match, the function answers `403` and sends nothing.

## Smoke Test

```bash
npm run test:smoke
```

The smoke test now targets Supabase. Provide one of these before running it:

- `TEST_SUPABASE_ACCESS_TOKEN`: recommended, runs through the real authenticated-user flow
- `SUPABASE_SERVICE_ROLE_KEY`: recommended for admin-style smoke testing without a user token
