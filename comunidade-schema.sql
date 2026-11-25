-- Afinzer Comunidade: perguntas, respostas e reputacao.
-- Complementa, sem modificar, posts / curtidas_posts / comentarios_posts do Android.
CREATE TABLE IF NOT EXISTS public.comunidade_perguntas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  autor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  titulo text NOT NULL CHECK (char_length(btrim(titulo)) BETWEEN 10 AND 180),
  detalhes text NOT NULL DEFAULT '' CHECK (char_length(detalhes) <= 2500),
  categoria text NOT NULL DEFAULT 'Geral' CHECK (categoria IN
    ('Geral','Amizade','Relacionamentos','Trabalho','Estudos','Tecnologia','Hobbies','Vida')),
  resposta_util_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.comunidade_respostas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pergunta_id uuid NOT NULL REFERENCES public.comunidade_perguntas(id) ON DELETE CASCADE,
  autor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conteudo text NOT NULL CHECK (char_length(btrim(conteudo)) BETWEEN 10 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT comunidade_resposta_unica UNIQUE (pergunta_id, autor_id)
);

ALTER TABLE public.comunidade_perguntas
  ADD CONSTRAINT comunidade_perguntas_resposta_util_fkey
  FOREIGN KEY (resposta_util_id) REFERENCES public.comunidade_respostas(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS comunidade_perguntas_recentes_idx
  ON public.comunidade_perguntas (created_at DESC, id);
CREATE INDEX IF NOT EXISTS comunidade_perguntas_autor_idx
  ON public.comunidade_perguntas (autor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS comunidade_respostas_por_pergunta_idx
  ON public.comunidade_respostas (pergunta_id, created_at, id);
CREATE INDEX IF NOT EXISTS comunidade_respostas_por_autor_idx
  ON public.comunidade_respostas (autor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS comunidade_perguntas_util_idx
  ON public.comunidade_perguntas (resposta_util_id)
  WHERE resposta_util_id IS NOT NULL;

ALTER TABLE public.comunidade_perguntas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comunidade_respostas ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.comunidade_perguntas, public.comunidade_respostas FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.comunidade_perguntas, public.comunidade_respostas TO authenticated;
GRANT UPDATE (resposta_util_id) ON public.comunidade_perguntas TO authenticated;

CREATE POLICY comunidade_perguntas_ler ON public.comunidade_perguntas
  FOR SELECT TO authenticated USING (true);
CREATE POLICY comunidade_perguntas_criar ON public.comunidade_perguntas
  FOR INSERT TO authenticated WITH CHECK (
    autor_id = (SELECT auth.uid())
    AND resposta_util_id IS NULL
    AND (public.moderacao_minha_restricao()->>'restrita')::boolean IS NOT TRUE
  );
CREATE POLICY comunidade_perguntas_destacar_resposta ON public.comunidade_perguntas
  FOR UPDATE TO authenticated USING (
    autor_id = (SELECT auth.uid()) AND resposta_util_id IS NULL
  ) WITH CHECK (
    autor_id = (SELECT auth.uid())
    AND (resposta_util_id IS NULL OR EXISTS (
      SELECT 1 FROM public.comunidade_respostas r
      WHERE r.id = resposta_util_id AND r.pergunta_id = public.comunidade_perguntas.id
        AND r.autor_id <> (SELECT auth.uid())
    ))
    AND (public.moderacao_minha_restricao()->>'restrita')::boolean IS NOT TRUE
  );
CREATE POLICY comunidade_respostas_ler ON public.comunidade_respostas
  FOR SELECT TO authenticated USING (true);
CREATE POLICY comunidade_respostas_criar ON public.comunidade_respostas
  FOR INSERT TO authenticated WITH CHECK (
    autor_id = (SELECT auth.uid())
    AND (public.moderacao_minha_restricao()->>'restrita')::boolean IS NOT TRUE
    AND EXISTS (
      SELECT 1 FROM public.comunidade_perguntas p
      WHERE p.id = pergunta_id AND p.autor_id <> (SELECT auth.uid())
    )
  );

-- Security invoker: o resultado usa RLS das tabelas base e nao expõe dados de login.
CREATE OR REPLACE VIEW public.comunidade_reputacao
WITH (security_invoker = true) AS
  SELECT r.autor_id AS usuario_id,
    count(*)::integer AS total_respostas,
    count(p.id)::integer AS respostas_uteis
  FROM public.comunidade_respostas r
  LEFT JOIN public.comunidade_perguntas p ON p.resposta_util_id = r.id
  GROUP BY r.autor_id;
REVOKE ALL ON public.comunidade_reputacao FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.comunidade_reputacao TO authenticated;

NOTIFY pgrst, 'reload schema';
