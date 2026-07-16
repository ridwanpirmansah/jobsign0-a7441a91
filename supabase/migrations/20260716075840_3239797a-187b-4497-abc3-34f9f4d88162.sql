
CREATE TABLE IF NOT EXISTS public.user_feature_permissions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, feature_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_feature_permissions TO authenticated;
GRANT ALL ON public.user_feature_permissions TO service_role;

ALTER TABLE public.user_feature_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own feature perms"
  ON public.user_feature_permissions FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'owner'));

CREATE POLICY "Owners manage feature perms"
  ON public.user_feature_permissions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'owner'))
  WITH CHECK (public.has_role(auth.uid(), 'owner'));

CREATE TRIGGER update_user_feature_permissions_updated_at
  BEFORE UPDATE ON public.user_feature_permissions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
