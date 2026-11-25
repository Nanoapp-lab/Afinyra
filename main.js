const menu = document.querySelector('.nav-toggle');
const nav = document.querySelector('#navegacao');
if (menu && nav) {
  menu.addEventListener('click', () => {
    const open = menu.getAttribute('aria-expanded') === 'true';
    menu.setAttribute('aria-expanded', String(!open));
    menu.textContent = open ? '☰' : '✕';
    nav.classList.toggle('open', !open);
  });
  nav.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
    menu.setAttribute('aria-expanded', 'false');
    menu.textContent = '☰';
    nav.classList.remove('open');
  }));
}
const year = document.querySelector('#ano');
if (year) year.textContent = String(new Date().getFullYear());

// O site publico reconhece a sessao mantida na mesma aba e no mesmo dominio.
// O perfil confirma a autenticacao com o Supabase antes de exibir dados privados.
try {
  const saved = JSON.parse(sessionStorage.getItem('vibeorbit_portal_session_v1') || 'null');
  if (saved?.access_token && saved?.refresh_token) {
    document.querySelectorAll('a[href="entrar.html"]').forEach(link => {
      link.textContent = 'Escolher entrada';
    });
  }
} catch { /* Nao ha sessao valida armazenada nesta aba. */ }
