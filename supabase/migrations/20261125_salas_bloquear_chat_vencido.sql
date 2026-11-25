-- Uma sala encerrada não pode continuar recebendo mensagens por RPCs antigas.
-- Preserva as regras de tempo e Premium existentes; adiciona somente validade.
BEGIN;

CREATE OR REPLACE FUNCTION public.pode_usar_sala_assunto(p_sala_id text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.salas
      WHERE id = p_sala_id AND expira_em > now()
    )
    AND public.meu_premium_ativo();
$function$;

CREATE OR REPLACE FUNCTION public.tempo_sala_assunto(p_sala_id text, p_acao text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_usuario uuid := auth.uid();
  v_dia date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_uso public.uso_salas_assunto%ROWTYPE;
  v_premium boolean;
BEGIN
  IF v_usuario IS NULL THEN RAISE EXCEPTION 'Autenticacao necessaria'; END IF;
  IF p_acao IS NULL OR p_acao NOT IN ('entrar', 'ping', 'sair') THEN
    RAISE EXCEPTION 'Acao invalida';
  END IF;
  IF p_sala_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.salas WHERE id = p_sala_id)
    OR p_sala_id = 'Global' THEN RAISE EXCEPTION 'Sala invalida'; END IF;

  -- Ainda é possível registrar a saída para encerrar o uso, mesmo vencida.
  IF p_acao <> 'sair'
    AND NOT EXISTS (SELECT 1 FROM public.salas WHERE id = p_sala_id AND expira_em > now()) THEN
    RETURN jsonb_build_object('permitido', false, 'premium', false,
      'segundos_restantes', 0, 'motivo', 'expired');
  END IF;

  v_premium := public.meu_premium_ativo();
  IF NOT v_premium AND p_acao <> 'sair' THEN
    RETURN jsonb_build_object('permitido', false, 'premium', false,
      'segundos_restantes', 0, 'motivo', 'premium_required');
  END IF;

  INSERT INTO public.uso_salas_assunto(usuario_id, dia)
  VALUES (v_usuario, v_dia) ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT v_uso FROM public.uso_salas_assunto
  WHERE usuario_id = v_usuario AND dia = v_dia FOR UPDATE;

  IF p_acao = 'ping' AND (
    v_uso.sala_id IS DISTINCT FROM p_sala_id
    OR v_uso.ultimo_ping IS NULL
    OR v_uso.ultimo_ping < now() - interval '45 seconds'
  ) THEN RAISE EXCEPTION 'Sessao encerrada: entre novamente'; END IF;

  IF p_acao = 'sair' THEN
    IF v_uso.sala_id = p_sala_id THEN
      UPDATE public.uso_salas_assunto SET sala_id = NULL, ultimo_ping = NULL
      WHERE usuario_id = v_usuario AND dia = v_dia;
    END IF;
  ELSIF v_premium THEN
    UPDATE public.uso_salas_assunto SET sala_id = p_sala_id, ultimo_ping = now()
    WHERE usuario_id = v_usuario AND dia = v_dia;
  END IF;

  RETURN jsonb_build_object('permitido', v_premium, 'premium', v_premium,
    'segundos_restantes', CASE WHEN v_premium THEN 86400 ELSE 0 END);
END;
$function$;

COMMIT;
