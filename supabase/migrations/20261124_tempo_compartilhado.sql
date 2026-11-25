-- Requer o esquema ativo do Afinzer V22. Aplicação atômica e repetível.
BEGIN;

CREATE OR REPLACE FUNCTION public.assunto_usa_saldo_diario(p_sala_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT starts_with(p_sala_id, 'public:assunto_')
    AND EXISTS (SELECT 1 FROM public.salas s WHERE s.id = p_sala_id AND btrim(s.cidade) = '')
    AND public.pode_usar_chat_global();
$$;

CREATE OR REPLACE FUNCTION public.tempo_assunto_compartilhado(p_sala_id text, p_acao text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.salas s WHERE s.id = p_sala_id
    AND starts_with(s.id, 'public:assunto_') AND btrim(s.cidade) = '') THEN
    RAISE EXCEPTION 'Sala por assunto não encontrada';
  END IF;
  RETURN public.tempo_chat_global(p_acao);
END;
$$;

REVOKE ALL ON FUNCTION public.assunto_usa_saldo_diario(text), public.tempo_assunto_compartilhado(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assunto_usa_saldo_diario(text), public.tempo_assunto_compartilhado(text,text) TO authenticated;

-- Estende somente as seis regras restritivas que na V22 exigem Premium em salas por assunto.
-- Preserva os predicados anteriores, o remetente autenticado e as outras políticas.
DO $$
DECLARE
  regra record;
  criterio text;
  total integer := 0;
BEGIN
  FOR regra IN SELECT * FROM pg_catalog.pg_policies WHERE schemaname = 'public'
    AND tablename = 'mensagens' AND permissive = 'RESTRICTIVE'
    AND policyname IN ('mensagens_assunto_limite_select', 'mensagens_assunto_limite_insert',
    'mensagens_limite_global_premium_select', 'mensagens_limite_global_premium_insert',
    'mensagens_somente_premium_fora_global_select', 'mensagens_somente_premium_fora_global_insert')
  LOOP
    total := total + 1;
    criterio := CASE regra.cmd WHEN 'SELECT' THEN regra.qual WHEN 'INSERT' THEN regra.with_check END;
    IF criterio IS NULL THEN RAISE EXCEPTION 'Regra inesperada: %', regra.policyname; END IF;
    IF position('assunto_usa_saldo_diario' IN criterio) = 0 THEN
      IF regra.cmd = 'SELECT' THEN
        EXECUTE format('ALTER POLICY %I ON public.mensagens USING ((%s) OR public.assunto_usa_saldo_diario(sala_id))', regra.policyname, criterio);
      ELSE
        EXECUTE format('ALTER POLICY %I ON public.mensagens WITH CHECK ((%s) OR (id_remetente = auth.uid() AND public.assunto_usa_saldo_diario(sala_id)))', regra.policyname, criterio);
      END IF;
    END IF;
  END LOOP;
  IF total <> 6 THEN RAISE EXCEPTION 'O esquema diverge da V22. Nenhuma mudança aplicada.'; END IF;
END;
$$;
COMMIT;
