function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
}

function byId(id) { return document.getElementById(id); }

export async function configureCitySelectors() {
  const configs = [
    { field: 'profile-city', prefix: 'city-current' },
    { field: 'profile-origin', prefix: 'city-origin' }
  ];

  let states;
  try {
    const response = await fetch('./cidades_brasil.json', { cache: 'force-cache' });
    if (!response.ok) throw new Error('Lista de cidades indisponível');
    const json = await response.json();
    if (!Array.isArray(json.estados) || json.estados.length < 27) throw new Error('Lista incompleta');
    states = json.estados;
  } catch {
    configs.forEach(({ field, prefix }) => {
      byId(field).readOnly = false;
      byId(`${prefix}-state`).disabled = true;
      byId(`${prefix}-search`).disabled = true;
      byId(`${prefix}-hint`).textContent = 'Não foi possível abrir a lista. Você pode digitar a cidade manualmente.';
    });
    return;
  }

  for (const { field, prefix } of configs) {
    const text = byId(field);
    const uf = byId(`${prefix}-state`);
    const search = byId(`${prefix}-search`);
    const results = byId(`${prefix}-results`);
    const hint = byId(`${prefix}-hint`);
    const clear = byId(`${prefix}-clear`);

    const currentlySavedUF = / - ([A-Z]{2})$/.exec(text.value)?.[1];
    for (const state of states) {
      const item = document.createElement('option');
      item.value = state.sigla;
      item.textContent = `${state.nome} (${state.sigla})`;
      uf.append(item);
    }
    if (currentlySavedUF) uf.value = currentlySavedUF;
    search.disabled = !uf.value;

    const render = () => {
      results.replaceChildren();
      const query = normalize(search.value.trim());
      const state = states.find(item => item.sigla === uf.value);
      if (!state || query.length < 2) {
        results.hidden = true;
        hint.textContent = state ? 'Digite pelo menos duas letras para procurar a cidade.' : 'Escolha primeiro o estado.';
        return;
      }
      const matched = state.cidades.filter(city => normalize(city).includes(query)).slice(0, 60);
      for (const city of matched) {
        const item = document.createElement('option');
        item.value = city;
        item.textContent = city;
        results.append(item);
      }
      results.hidden = matched.length === 0;
      hint.textContent = matched.length ? `${matched.length} resultado(s). Selecione sua cidade na lista.` : 'Nenhuma cidade encontrada.';
    };

    uf.addEventListener('change', () => {
      search.disabled = !uf.value;
      search.value = '';
      results.hidden = true;
      // A state change is incomplete until a city is chosen. Do not submit an old city.
      text.value = '';
      render();
      if (uf.value) search.focus();
    });
    search.addEventListener('input', render);
    results.addEventListener('change', () => {
      if (!results.value || !uf.value) return;
      text.value = `${results.value} - ${uf.value}`;
      results.hidden = true;
      search.value = '';
      hint.textContent = `Cidade escolhida: ${text.value}`;
    });
    clear.addEventListener('click', () => {
      text.value = '';
      search.value = '';
      render();
    });
    render();
  }
}
