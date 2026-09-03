CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS private.cron_tokens (
  name text PRIMARY KEY,
  token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON private.cron_tokens FROM PUBLIC, anon, authenticated;

INSERT INTO private.cron_tokens (name, token)
VALUES ('wh_nightly', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.verify_cron_token(_name text, _token text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = private, public AS $$
DECLARE ok boolean;
BEGIN
  SELECT (t.token = _token) INTO ok FROM private.cron_tokens t WHERE t.name = _name;
  RETURN COALESCE(ok, false);
END; $$;

REVOKE ALL ON FUNCTION public.verify_cron_token(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_cron_token(text, text) TO service_role;