-- Fires the notify-feedback Edge Function whenever a new feedback row lands,
-- so the owner gets an email without the backend knowing about mail at all.
--
-- Prerequisites:
--   1. supabase/otworker_feedback.sql has been applied.
--   2. The Edge Function is deployed:
--        supabase functions deploy notify-feedback
--   3. Its secrets are set:
--        supabase secrets set RESEND_API_KEY=... FEEDBACK_ALERT_TO=you@example.com
--        supabase secrets set FEEDBACK_WEBHOOK_SECRET=<same value as below>
--
-- Replace <PROJECT_REF>, <WEBHOOK_SECRET>, and <SUPABASE_ANON_KEY> before
-- running this in the Supabase SQL Editor.

create extension if not exists pg_net with schema extensions;

create or replace function public.notify_otworker_feedback()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  function_url text := 'https://<PROJECT_REF>.supabase.co/functions/v1/notify-feedback';
  webhook_secret text := '<WEBHOOK_SECRET>';
  -- Sent so the call also works when the function keeps Supabase's default JWT
  -- gate; the real authentication is the shared secret above. The anon key is
  -- public (the frontend ships it), so it is safe to inline here.
  anon_key text := '<SUPABASE_ANON_KEY>';
begin
  perform extensions.http_post(
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

  return new;
end;
$$;

drop trigger if exists otworker_feedback_notify on public.otworker_feedback;

-- AFTER INSERT so a failing mail call can never block the user's submission.
create trigger otworker_feedback_notify
after insert on public.otworker_feedback
for each row
execute function public.notify_otworker_feedback();
