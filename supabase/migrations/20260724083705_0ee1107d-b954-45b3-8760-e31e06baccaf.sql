
CREATE TABLE public.shopping_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_name text NOT NULL,
  qty text,
  note text,
  urgency text NOT NULL DEFAULT 'normal' CHECK (urgency IN ('normal','urgent')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','purchased')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  purchased_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  purchased_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shopping_notes TO authenticated;
GRANT ALL ON public.shopping_notes TO service_role;

ALTER TABLE public.shopping_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shopping_notes_select_authenticated" ON public.shopping_notes
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "shopping_notes_insert_authenticated" ON public.shopping_notes
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);

CREATE POLICY "shopping_notes_update_own_or_admin" ON public.shopping_notes
  FOR UPDATE TO authenticated
  USING (auth.uid() = created_by OR public.is_admin_or_owner(auth.uid()) OR status = 'pending')
  WITH CHECK (true);

CREATE POLICY "shopping_notes_delete_own_or_admin" ON public.shopping_notes
  FOR DELETE TO authenticated
  USING (auth.uid() = created_by OR public.is_admin_or_owner(auth.uid()));

CREATE TRIGGER shopping_notes_set_updated_at
  BEFORE UPDATE ON public.shopping_notes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX shopping_notes_status_idx ON public.shopping_notes(status, created_at DESC);
