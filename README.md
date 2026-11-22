# Afinyra — site institucional (pré-lançamento)

Arquivos estáticos HTML, CSS e JavaScript do site VibeOrbit, com ícone original do aplicativo Android e crédito “Designed by Zetriv Technologies LTDA”.

## Publicar no GitHub Pages

1. Descompacte este ZIP no computador. **Não envie o ZIP fechado para o repositório.**
2. Entre na conta GitHub **Nanoapp-lab** e crie um repositório chamado `vibeorbit-site`.
3. Acesse o repositório, clique em **Add file → Upload files** e envie os arquivos e a pasta `assets` descompactados, mantendo `index.html` na raiz.
4. Confirme as alterações em `main`.
5. Vá em **Settings → Pages → Build and deployment → Deploy from a branch**.
6. Selecione **main** e **/(root)**, clique em **Save** e aguarde a implantação.
7. Depois da publicação, o endereço esperado será `https://nanoapp-lab.github.io/Afinyra/`.

Para um domínio próprio, configure **Custom domain** no Pages e só então ajuste o DNS no provedor do domínio; o domínio deve pertencer a você.

## Recomendações para o Afinyra comercial

- O GitHub é ótimo para versionar o código. Para a futura operação comercial, considere hospedar o site na Cloudflare Pages conectado ao repositório GitHub.
- Este pacote **não** contém dados do Supabase, senhas, chaves secretas, dados biométricos, credenciais Didit, backend ou pagamentos.
- As páginas de privacidade, diretrizes e exclusão de conta são **rascunhos**. Precisam ser validadas e corresponder aos fluxos reais antes de usar o site como documento oficial da Google Play.
- As páginas contêm `noindex,nofollow` durante o pré-lançamento: motores de busca não devem indexá-las. Quando estiver pronto para divulgação pública, revise o conteúdo e remova essa diretiva.
- Não processe dados de usuários nem pagamentos diretamente em GitHub Pages.

Projeto: Afinyra• Designed by Zetriv Technologies LTDA.
