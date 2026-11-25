-- Salas Vivas: validade obrigatória e compartilhada entre Android e web.
-- Novas salas: 2, 12, 24 ou 168 horas (padrão 24h para clientes antigos).
-- Salas anteriores à migração: sete dias de transição, sem exclusão de mensagens.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'salas'
      AND policyname = 'salas_assunto_ler' AND cmd = 'SELECT' AND qual = 'true')
  OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'salas'
      AND policyname = 'salas_criar_apenas_premium' AND cmd = 'INSERT')
  OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'salas'
      AND policyname = 'salas_assunto_criar' AND cmd = 'INSERT') THEN
    RAISE EXCEPTION 'Politicas de salas divergiram: revisar antes de aplicar validade';
  END IF;
END;
$$;

ALTER TABLE public.salas
  ADD COLUMN duracao_horas integer NOT NULL DEFAULT 24,
  ADD COLUMN expira_em timestamptz;

-- Não se removem salas ou mensagens antigas no momento da mudança.
UPDATE public.salas SET expira_em = now() + interval '7 days'
WHERE expira_em IS NULL;

ALTER TABLE public.salas
  ALTER COLUMN expira_em SET NOT NULL,
  ALTER COLUMN expira_em SET DEFAULT (now() + interval '24 hours'),
  ADD CONSTRAINT salas_duracao_horas_check CHECK (duracao_horas IN (2, 12, 24, 168));

CREATE INDEX salas_expira_em_idx ON public.salas (expira_em);

-- O servidor fixa o início e o encerramento. O cliente só informa a duração;
-- não pode fabricar data futura nem estender uma sala depois de criada.
CREATE FUNCTION private.salas_aplicar_validade()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
    NEW.duracao_horas := COALESCE(NEW.duracao_horas, 24);
    NEW.expira_em := NEW.created_at + make_interval(hours => NEW.duracao_horas);
  ELSE
    NEW.created_at := OLD.created_at;
    NEW.duracao_horas := OLD.duracao_horas;
    NEW.expira_em := OLD.expira_em;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER salas_validade_automatica
  BEFORE INSERT OR UPDATE ON public.salas
  FOR EACH ROW EXECUTE FUNCTION private.salas_aplicar_validade();

-- O filtro RLS vale para site e aplicativo Android, inclusive clientes antigos.
ALTER POLICY salas_assunto_ler ON public.salas
  USING (expira_em > now());

-- Apenas Premium autenticado pode criar, sempre em seu próprio nome.
-- Remove a antiga segunda política permissiva que permitia contornar Premium.
ALTER POLICY salas_criar_apenas_premium ON public.salas
  WITH CHECK (
    criador_id = (SELECT auth.uid())
    AND public.meu_premium_ativo()
    AND (id LIKE 'public:cidade_%' OR id LIKE 'public:assunto_%')
  );
DROP POLICY salas_assunto_criar ON public.salas;

COMMIT;
