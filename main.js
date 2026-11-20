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
