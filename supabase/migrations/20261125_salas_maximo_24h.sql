-- Ajuste pedido: sete dias e muito tempo. Prazo maximo 24 horas.
-- Apenas encurta a validade das salas; nenhuma sala ou mensagem e excluida.
BEGIN;

ALTER TABLE public.salas DROP CONSTRAINT salas_duracao_horas_check;
ALTER TABLE public.salas
  ADD CONSTRAINT salas_duracao_horas_check CHECK (duracao_horas IN (2, 12, 24));

-- Mantem as datas anteriores imutaveis, mas permite antecipar o encerramento.
CREATE OR REPLACE FUNCTION private.salas_aplicar_validade()
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
    NEW.expira_em := LEAST(OLD.expira_em, NEW.expira_em);
  END IF;
  RETURN NEW;
END;
$function$;

UPDATE public.salas
SET expira_em = now() + interval '24 hours'
WHERE expira_em > now() + interval '24 hours';

COMMIT;
