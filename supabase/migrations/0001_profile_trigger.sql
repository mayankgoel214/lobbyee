-- Supabase-only migration (references auth.users, which exists only on
-- Supabase — never run against the CI Postgres). Creates a public.profile
-- row for every new auth user. See docs/architecture.md §3a.
--
-- Domain rule (docs/architecture.md §10): this folder is for Supabase-native
-- resources only (auth triggers, storage policies). Tables are owned by
-- Prisma migrations — never touch them here.

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- auth.users.email is nullable (phone auth, some OAuth providers);
  -- profile.email is NOT NULL — a bare NEW.email would make signup itself
  -- fail. Fall back to a stable synthetic address.
  INSERT INTO public.profile (id, email, full_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, NEW.id::text || '@no-email.lobbyee.invalid'),
    NEW.raw_user_meta_data ->> 'full_name'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Trigger functions must never be callable via the PostgREST RPC surface
-- (Supabase security advisor lints 0028/0029).
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
