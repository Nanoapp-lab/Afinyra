-- Afinzer: acesso direto a usuarios apenas ao proprio cadastro.
-- O Deck continua recebendo somente id e objetivo pela RPC, nunca a linha inteira.
-- Aplicacao atomica. Nao apaga ou atualiza dados dos participantes.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'usuarios' AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'RLS nao esta ativo em public.usuarios';
  END IF;

  IF (SELECT count(*) FROM pg_catalog.pg_policies
      WHERE schemaname = 'public' AND tablename = 'usuarios'
        AND cmd = 'SELECT' AND permissive = 'PERMISSIVE'
        AND qual = 'true'
        AND policyname IN (
          'Usuarios podem ler todos os perfis',
          'Usuários podem ver perfis na órbita'
        )) <> 2 THEN
    RAISE EXCEPTION 'As politicas antigas diferem das conferidas; revisar antes de alterar';
  END IF;
END;
$$;

-- A RPC de afinidades precisa ler os objetivos de outros perfis mesmo apos a
-- restricao. Ela retorna apenas dois campos, exige autenticacao e filtra os
-- perfis com a mesma visao segura utilizada pelo aplicativo Android.
CREATE OR REPLACE FUNCTION public.objetivos_conexao_deck()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticacao necessaria' USING ERRCODE = '28000';
  END IF;
  RETURN (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', u.id, 'objetivo_conexao', u.objetivo_conexao
    )), '[]'::jsonb)
    FROM public.perfis_app p
    JOIN public.usuarios u ON u.id = p.id
    WHERE u.objetivo_conexao IS NOT NULL
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.objetivos_conexao_deck() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.objetivos_conexao_deck() TO authenticated;

DROP POLICY "Usuarios podem ler todos os perfis" ON public.usuarios;
DROP POLICY "Usuários podem ver perfis na órbita" ON public.usuarios;

CREATE POLICY "Usuarios podem ler o proprio perfil"
ON public.usuarios FOR SELECT TO authenticated
USING ((SELECT auth.uid()) = id);

COMMIT;
