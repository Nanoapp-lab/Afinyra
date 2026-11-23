# Afinzer — site e portal (pré-lançamento)

Site oficial em português do **Afinzer**, desenvolvido pela **Zetriv Technologies LTDA**. A identidade visual utiliza o símbolo Afinzer em `assets/afinzer-icon.svg`.

## Organização

- Repositório GitHub: `Nanoapp-lab/Afinzer`.
- Projeto Vercel: `afinzer-site`.
- Branch de produção: `main`. A integração Git da Vercel publica os commits enviados a essa branch.
- Branches de recursos: utilizadas para prévias e revisão antes da integração à `main`.
- Páginas: `index.html`, `baixar.html`, `entrar.html`, `conta.html`, `admin.html`, `diretrizes.html`, `privacidade.html` e `exclusao.html`.

O nome do projeto na Vercel, o endereço `*.vercel.app` e o conteúdo do site são configurações distintas. O endereço anterior pode continuar ativo até que o domínio definitivo seja atribuído e os links externos sejam atualizados.

## Publicação

1. Revise a prévia de uma branch e confirme o logotipo, a navegação e as páginas.
2. Integre a branch revisada à `main` no GitHub.
3. Confira em **Vercel → afinzer-site → Deployments** se a implantação de **Production** corresponde ao commit da `main`.
4. Teste o endereço de produção, incluindo a página inicial, acesso à conta e páginas de transparência.
5. Em **Settings → Domains**, configure o novo domínio quando estiver disponível. Preserve o endereço anterior enquanto houver usuários ou links que dependam dele.

## Segurança e lançamento

- O portal usa Supabase Auth e moderação. A operação depende de políticas RLS e da função administrativa instalada no servidor.
- Nomes técnicos anteriores, como `vibeorbit-moderacao` e a chave local de sessão, permanecem por compatibilidade; **não** são a marca apresentada ao público.
- Nunca publique chaves `service_role`, credenciais de administrador ou dados pessoais no repositório.
- As páginas de privacidade, diretrizes e exclusão ainda contêm avisos de prévia e precisam corresponder aos procedimentos reais antes da publicação na Google Play.
- A indexação e as políticas devem ser revisadas antes do lançamento público.

© Afinzer — Designed by Zetriv Technologies LTDA.
