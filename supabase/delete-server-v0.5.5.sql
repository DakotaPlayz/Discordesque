-- Mirlume 0.5.5: server deletion repair.
-- Run in your Supabase SQL Editor. This changes only public foreign keys
-- referring to Mirlume server-owned rows so deleting a server removes
-- related channels, messages, settings and memberships instead of failing.
-- Review before running if other applications use these tables.
DO $$
DECLARE
  fk record;
  definition text;
BEGIN
  FOR fk IN
    SELECT c.conname, c.conrelid, c.confrelid
    FROM pg_constraint c
    JOIN pg_namespace child_ns ON child_ns.oid = (SELECT relnamespace FROM pg_class WHERE oid=c.conrelid)
    JOIN pg_class parent_table ON parent_table.oid=c.confrelid
    JOIN pg_namespace parent_ns ON parent_ns.oid=parent_table.relnamespace
    WHERE c.contype='f'
      AND child_ns.nspname='public' AND parent_ns.nspname='public'
      AND parent_table.relname IN ('servers','channels','messages','server_members')
      AND c.confdeltype <> 'c'
  LOOP
    SELECT pg_get_constraintdef(c.oid) INTO definition
    FROM pg_constraint c WHERE c.conrelid=fk.conrelid AND c.conname=fk.conname;
    -- Preserve other FK attributes while replacing the ON DELETE behavior.
    definition := regexp_replace(definition, ' ON DELETE (NO ACTION|RESTRICT|CASCADE|SET NULL|SET DEFAULT)', '', 'i');
    definition := regexp_replace(definition, ' (DEFERRABLE|NOT DEFERRABLE)', ' ON DELETE CASCADE \\1', 'i');
    IF position('ON DELETE CASCADE' IN definition)=0 THEN
      definition := definition || ' ON DELETE CASCADE';
    END IF;
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', fk.conrelid::regclass, fk.conname);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', fk.conrelid::regclass, fk.conname, definition);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.mirlume_delete_server(p_server uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  current_user_id uuid := auth.uid();
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Sign in required' USING ERRCODE = '28000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.servers WHERE id=p_server AND owner_id=current_user_id) THEN
    RAISE EXCEPTION 'Server not found or you are not its owner' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.servers WHERE id=p_server AND owner_id=current_user_id;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.mirlume_delete_server(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mirlume_delete_server(uuid) TO authenticated;

-- Inspect remaining references to server-owned tables if deletion still fails:
SELECT conrelid::regclass AS dependent_table, conname,
       confrelid::regclass AS referenced_table, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE contype='f' AND confrelid IN (
  'public.servers'::regclass, 'public.channels'::regclass,
  'public.messages'::regclass, 'public.server_members'::regclass
);

-- Receive incoming DM notifications through Supabase Realtime.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.direct_messages'))
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='direct_messages'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.direct_messages;
  END IF;
END $$;
