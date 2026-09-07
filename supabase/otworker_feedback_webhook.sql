-- Fires the notify-feedback Edge Function whenever a new feedback row lands,
-- so the owner gets an email without the backend knowing about mail at all.
--
-- Prerequisites:
--   1. supabase/otworker_feedback.sql has been applied.
--   2. The Edge Function is deployed:
--        supabase functions deploy notify-feedback
--   3. All FOUR secrets are set. Every one of them is required -- the function
--      fails closed on each, and the failure is silent from the app's side
--      because this trigger deliberately swallows errors (see below):
--        supabase secrets set RESEND_API_KEY=re_...
--        supabase secrets set FEEDBACK_ALERT_TO=you@example.com
--        supabase secrets set 'FEEDBACK_ALERT_FROM=OT Worker <you@verified-domain.com>'
--        supabase secrets set FEEDBACK_WEBHOOK_SECRET=<same value as below>
--
--      FEEDBACK_ALERT_FROM has a fallback in the function
--      ("OT Worker <onboarding@resend.dev>"), so it looks optional. It is not:
--      that sandbox address only delivers to the Resend account owner's own
--      address, and Resend rejects the send outright when the from-domain is
--      not verified in YOUR Resend account. Use an address on a domain you
--      have added DNS records for. Quote the value -- the angle brackets are
--      redirection operators in PowerShell and bash.
--
-- Replace <PROJECT_REF>, <WEBHOOK_SECRET>, and <SUPABASE_ANON_KEY> below
-- before running this in the Supabase SQL Editor. WEBHOOK_SECRET must match
-- the FEEDBACK_WEBHOOK_SECRET secret byte for byte; the anon key must be the
-- real one (Dashboard -> Settings -> API, or `supabase projects api-keys`).
--
-- Troubleshooting: this trigger cannot report failures to the caller, so a
-- broken mail path looks exactly like a working one from the app. pg_net logs
-- every response instead -- that table is the only place the truth shows up:
--
--   select id, status_code, content, error_msg, created
--   from net._http_response
--   order by created desc limit 10;
--
--   (no rows) -- this file was never applied; run it
--   401       -- anon_key below is wrong or still a placeholder
--   403       -- webhook_secret below != FEEDBACK_WEBHOOK_SECRET secret
--   502       -- Resend refused the send. The reason is NOT in `content`; the
--                function only console.error()s it. Check Resend Dashboard ->
--                Emails for the real cause, usually an unverified from-domain
--                or a bad RESEND_API_KEY.
--   200       -- sent; if no mail arrives, check the spam folder

create extension if not exists pg_net with schema extensions;

create or replace function public.notify_otworker_feedback()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, net
as $$
declare
  function_url text := 'https://<PROJECT_REF>.supabase.co/functions/v1/notify-feedback';
  webhook_secret text := '<WEBHOOK_SECRET>';
  -- Sent so the call also works when the function keeps Supabase's default JWT
  -- gate; the real authentication is the shared secret above. The anon key is
  -- public (the frontend ships it), so it is safe to inline here.
  anon_key text := '<SUPABASE_ANON_KEY>';
begin
  -- An AFTER INSERT trigger still runs inside the caller's transaction, so an
  -- error raised here would roll back the user's feedback. The mail call is
  -- best-effort: log any failure and let the insert stand.
  begin
    perform net.http_post(
      url := function_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || anon_key,
        'x-feedback-webhook-secret', webhook_secret
      ),
      body := jsonb_build_object(
        'type', 'INSERT',
        'table', 'otworker_feedback',
        'record', to_jsonb(new)
      ),
      timeout_milliseconds := 5000
    );
  exception
    when others then
      raise warning 'notify_otworker_feedback failed: % (%)', sqlerrm, sqlstate;
  end;

  return new;
end;
$$;

drop trigger if exists otworker_feedback_notify on public.otworker_feedback;

-- AFTER INSERT so a failing mail call can never block the user's submission.
create trigger otworker_feedback_notify
after insert on public.otworker_feedback
for each row
execute function public.notify_otworker_feedback();
