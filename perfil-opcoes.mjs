import { parseList } from './perfil-utils.mjs';

// Options and persisted objective values mirror PerfilEditarActivity.kt / ObjetivoConexao.kt.
const SINGLE = {
  genero: ["Mulher", "Homem", "Mulher trans", "Homem trans", "Não binário", "Outro", "Prefiro não informar"],
  buscando: ["Mulheres", "Homens", "Todos", "Pessoas não binárias", "Amizades", "Prefiro não informar"],
  objetivo_conexao: [
    ["namoro_serio", "❤️ Namoro sério"],
    ["conhecer_sem_pressa", "💞 Conhecer alguém sem pressa"],
    ["amizades", "🤝 Fazer amizades"],
    ["apenas_conversar", "💬 Apenas conversar"],
    ["Prefiro não informar", "Prefiro não informar"]
  ],
  escolaridade: [
    "Ensino fundamental", "Ensino médio", "Técnico", "Superior incompleto",
    "Superior completo", "Pós-graduação", "Mestrado", "Doutorado", "Prefiro não informar"
  ],
  filhos: ["Não tenho", "Tenho filhos", "Quero ter filhos", "Não quero ter filhos", "Prefiro não informar"],
  fumante: ["Não", "Socialmente", "Sim", "Estou parando", "Prefiro não informar"],
  bebida: ["Não bebo", "Socialmente", "Às vezes", "Frequentemente", "Prefiro não informar"],
  religiao: [
    "Prefiro não informar", "Sem religião", "Ateísmo", "Agnosticismo", "Catolicismo",
    "Protestantismo / Evangélica", "Cristianismo ortodoxo", "Outras vertentes cristãs",
    "Espiritismo", "Umbanda", "Candomblé", "Outras religiões afro-brasileiras",
    "Judaísmo", "Islamismo", "Budismo", "Hinduísmo", "Sikhismo", "Jainismo",
    "Taoismo", "Confucionismo", "Xintoísmo", "Fé Bahá'í",
    "Religiões indígenas / tradicionais", "Espiritualidade sem religião", "Outra"
  ]
};

const HOBBIES = [
  "🎵 Música", "Shows e festivais", "Rock", "Pop", "Sertanejo", "MPB",
  "Cinema", "Séries", "Leitura", "Escrever", "Fotografia", "Arte",
  "Dança", "Teatro", "Museus", "Jogos de tabuleiro", "Viagens", "Praia",
  "Natureza", "Trilhas", "Acampamento", "Ciclismo", "Corrida", "Caminhada",
  "Academia", "Yoga", "Futebol", "Vôlei", "Natação", "Artes marciais",
  "Culinária", "Cozinhar", "Cafés", "Gastronomia", "Vinhos", "Animais",
  "Cães", "Gatos", "Jardinagem", "Tecnologia", "Programação", "Games",
  "Astronomia", "Conversas profundas", "Voluntariado", "Meditação",
  "Espiritualidade", "Aprender idiomas", "Carros", "Motos"
];

const LANGUAGES = [
  "Português", "Inglês", "Espanhol", "Francês", "Alemão", "Italiano",
  "Japonês", "Mandarim", "Cantonês", "Coreano", "Árabe", "Hindi", "Russo",
  "Holandês", "Sueco", "Norueguês", "Dinamarquês", "Finlandês", "Polonês",
  "Turco", "Grego", "Hebraico", "Libras"
];

function addOption(select, value, label) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  select.append(option);
}

export function configureProfileOptions(form) {
  for (const [name, choices] of Object.entries(SINGLE)) {
    const field = form.elements.namedItem(name);
    if (!field) continue;
    addOption(field, '', 'Selecione uma opção');
    for (const entry of choices) {
      const [value, label] = Array.isArray(entry) ? entry : [entry, entry];
      addOption(field, value, label);
    }
  }

  const religion = form.elements.namedItem('religiao');
  const customReligion = document.getElementById('custom-religion');
  religion.addEventListener('change', () => { customReligion.hidden = religion.value !== 'Outra'; });

  const multi = [
    { name: 'hobbies', options: HOBBIES, target: 'hobby-options' },
    { name: 'idiomas', options: LANGUAGES, target: 'language-options' }
  ].map(({ name, options, target }) => {
    const field = form.elements.namedItem(name);
    const container = document.getElementById(target);
    const checkboxes = [];
    for (const option of options) {
      const label = document.createElement('label');
      label.className = 'choice-option';
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.value = option;
      label.append(check, document.createTextNode(option));
      container.append(label);
      checkboxes.push(check);
      check.addEventListener('change', () => {
        const extras = parseList(field.value, 70).filter(x => !options.includes(x));
        field.value = [...checkboxes.filter(x => x.checked).map(x => x.value), ...extras].join(', ');
      });
    }
    const hydrate = () => {
      const selected = new Set(parseList(field.value, 70));
      checkboxes.forEach(checkbox => { checkbox.checked = selected.has(checkbox.value); });
    };
    field.addEventListener('input', hydrate);
    return { hydrate };
  });

  return {
    prepareCustomChoices(profile) {
      for (const [name, choices] of Object.entries(SINGLE)) {
        const field = form.elements.namedItem(name);
        const value = profile?.[name];
        if (!value || [...field.options].some(opt => opt.value === value)) continue;
        addOption(field, value, `${value} (salvo no aplicativo)`);
      }
    },
    hydrateSelections() {
      multi.forEach(item => item.hydrate());
      customReligion.hidden = religion.value !== 'Outra';
    },
    religionValue() {
      if (religion.value === 'Outra') return customReligion.value.trim() || null;
      return religion.value === 'Prefiro não informar' ? null : religion.value || null;
    }
  };
}
