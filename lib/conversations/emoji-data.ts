// Emojis do seletor da caixa de mensagem. Lista própria e leve (sem biblioteca): cada item é "emoji|palavras de busca em português".
// A busca ignora acentos e maiúsculas. Organizada para o dia a dia de um corretor (casa, chave, dinheiro, agenda) além dos clássicos.

export type EmojiCategory = { id: string; label: string; icon: string; items: ReadonlyArray<string> };

export const EMOJI_CATEGORIES: ReadonlyArray<EmojiCategory> = [
  {
    id: "rostos",
    label: "Rostos",
    icon: "😀",
    items: [
      "😀|sorriso feliz alegre", "😃|sorriso aberto feliz", "😄|sorriso olhos felizes", "😁|sorriso dentes", "😆|rindo muito", "😅|riso suor aliviado",
      "😂|chorando de rir gargalhada", "🤣|rolando de rir", "🙂|sorrisinho leve", "🙃|de cabeca para baixo", "😉|piscada", "😊|sorriso corado feliz",
      "😇|anjo inocente", "🥰|apaixonado coracoes", "😍|olhos de coracao amei", "🤩|deslumbrado estrelas uau", "😘|beijo", "😗|beijinho",
      "😚|beijo olhos fechados", "😋|delicioso saboroso", "😛|lingua", "😜|lingua piscada brincadeira", "🤪|doido maluco", "😝|lingua olhos fechados",
      "🤗|abraco", "🤭|ops mao na boca", "🤫|silencio segredo", "🤔|pensando duvida", "🤐|boca fechada", "😐|neutro sem graca",
      "😑|sem expressao", "😶|sem boca", "😏|sorriso de lado", "😒|desanimado entediado", "🙄|revirando os olhos", "😬|constrangido",
      "😌|aliviado tranquilo", "😔|pensativo triste", "😪|sono", "😴|dormindo", "😷|mascara doente", "🤒|febre doente",
      "🤕|machucado", "🤢|enjoado", "🤮|vomitando", "🥵|calor", "🥶|frio", "😵|tonto",
      "🤯|mente explodindo", "🤠|vaqueiro", "🥳|festa comemorando", "😎|oculos escuros legal", "🤓|nerd", "🧐|monoculo curioso",
      "😕|confuso", "😟|preocupado", "🙁|triste leve", "☹️|triste", "😮|surpreso boca aberta", "😯|surpreso",
      "😲|chocado", "😳|envergonhado vermelho", "🥺|carinha pidona por favor", "😦|assustado", "😧|angustiado", "😨|com medo",
      "😰|ansioso suor frio", "😥|aliviado triste", "😢|chorando lagrima", "😭|chorando muito", "😱|gritando de medo", "😖|frustrado",
      "😣|perseverando", "😞|decepcionado", "😓|suor triste", "😩|exausto", "😫|cansado", "🥱|bocejo",
      "😤|bufando", "😡|bravo raiva", "😠|irritado", "🤬|xingando", "😈|diabinho", "💀|caveira",
      "💩|coco", "🤡|palhaco", "👻|fantasma", "🤖|robo",
    ],
  },
  {
    id: "gestos",
    label: "Gestos",
    icon: "👍",
    items: [
      "👍|joia positivo ok curtir", "👎|negativo nao curtir", "👌|ok perfeito", "✌️|paz vitoria", "🤞|dedos cruzados sorte", "🤟|te amo mao",
      "🤘|rock", "🤙|me liga telefone", "👈|apontando esquerda", "👉|apontando direita", "👆|apontando cima", "👇|apontando baixo",
      "☝️|dedo para cima", "✋|mao parada pare", "🤚|costas da mao", "🖐️|mao aberta", "👋|tchau ola aceno", "👏|palmas aplausos parabens",
      "🙌|maos para cima celebrar", "👐|maos abertas", "🤝|aperto de mao acordo negocio fechado", "🙏|obrigado por favor rezar", "💪|forca musculo", "🫶|maos coracao carinho",
      "✍️|escrevendo assinar", "💅|unhas", "🤳|selfie", "👀|olhos olhando", "🧠|cerebro", "🫡|continencia",
    ],
  },
  {
    id: "coracoes",
    label: "Corações e símbolos",
    icon: "❤️",
    items: [
      "❤️|coracao vermelho amor", "🧡|coracao laranja", "💛|coracao amarelo", "💚|coracao verde", "💙|coracao azul", "💜|coracao roxo",
      "🖤|coracao preto", "🤍|coracao branco", "💔|coracao partido", "❣️|exclamacao coracao", "💕|dois coracoes", "💞|coracoes girando",
      "💓|coracao batendo", "💗|coracao crescendo", "💖|coracao brilhante", "💘|coracao flecha", "💯|cem 100 nota maxima", "💢|raiva",
      "💥|explosao", "💫|tontura estrela", "💦|gotas agua suor", "💨|vento correndo", "🔥|fogo quente", "✨|brilho estrelas",
      "⭐|estrela", "🌟|estrela brilhante", "🎉|festa parabens confete", "🎊|confete bola", "🏆|trofeu campeao", "🥇|medalha ouro primeiro",
      "✅|certo feito concluido", "☑️|marcado", "✔️|certo", "❌|errado cancelar", "❎|errado", "⚠️|atencao aviso",
      "❗|exclamacao importante", "❓|pergunta duvida", "‼️|exclamacao dupla", "⛔|proibido", "🚫|proibido", "🔔|sino aviso notificacao",
      "🔕|sino silenciado", "➕|mais", "➖|menos", "➡️|seta direita", "⬅️|seta esquerda", "⬆️|seta cima",
      "⬇️|seta baixo", "🔄|atualizar recarregar", "🔝|topo", "🆗|ok", "🆕|novo", "🆓|gratis",
    ],
  },
  {
    id: "casa",
    label: "Imóveis e negócios",
    icon: "🏠",
    items: [
      "🏠|casa imovel lar", "🏡|casa com jardim", "🏢|predio edificio comercial", "🏬|loja shopping", "🏘️|casas condominio bairro", "🏗️|obra construcao",
      "🏙️|cidade", "🌆|cidade entardecer", "🌇|por do sol cidade", "🏞️|parque paisagem", "🌳|arvore", "🌴|palmeira praia",
      "🏖️|praia", "🏝️|ilha", "⛰️|montanha", "🛏️|cama quarto dormitorio", "🛋️|sofa sala", "🚿|chuveiro banheiro",
      "🛁|banheira", "🚪|porta", "🪟|janela", "🔑|chave", "🗝️|chave antiga", "🔒|cadeado fechado seguranca",
      "🔓|cadeado aberto", "📍|local endereco pin", "🗺️|mapa", "🧭|bussola", "📐|medida planta", "📏|regua medida metragem",
      "💰|dinheiro saco", "💵|dinheiro nota dolar", "💳|cartao de credito", "🏦|banco financiamento", "🪙|moeda", "📈|grafico subindo valorizacao",
      "📉|grafico caindo", "🧾|recibo nota", "📄|documento pagina contrato", "📃|documento", "📑|documentos", "📋|prancheta lista",
      "📝|anotacao escrever", "🖊️|caneta assinar", "✒️|caneta", "📎|clipe anexo", "📌|alfinete fixar", "🗂️|pastas arquivo",
      "📁|pasta", "📂|pasta aberta", "📅|calendario data agenda", "📆|calendario", "🗓️|agenda", "⏰|despertador horario",
      "⏳|ampulheta espera prazo", "🕐|uma hora relogio", "📞|telefone ligar", "📱|celular", "☎️|telefone fixo", "📧|email",
      "✉️|carta envelope", "📨|mensagem recebida", "📷|camera foto", "📸|foto flash", "🎥|filmadora video", "💻|notebook computador",
      "🖥️|computador", "🚗|carro garagem", "🅿️|estacionamento vaga", "🏊|piscina natacao", "🏋️|academia", "🍖|churrasqueira churrasco",
      "🌞|sol", "🌙|lua noite", "🐶|cachorro pet", "🐱|gato pet",
    ],
  },
  {
    id: "comida",
    label: "Comida e festa",
    icon: "🍕",
    items: [
      "☕|cafe", "🍵|cha", "🥤|refrigerante copo", "🍺|cerveja", "🍻|brinde cervejas", "🥂|brinde tacas champanhe",
      "🍷|vinho", "🍾|champanhe", "🍰|bolo fatia", "🎂|bolo aniversario", "🍫|chocolate", "🍪|biscoito",
      "🍕|pizza", "🍔|hamburguer", "🍟|batata frita", "🌭|cachorro quente", "🥪|sanduiche", "🌮|taco",
      "🍝|macarrao", "🍣|sushi", "🍎|maca", "🍌|banana", "🍉|melancia", "🍓|morango",
      "🥑|abacate", "🥗|salada", "🍽️|prato talheres refeicao", "🎁|presente", "🎈|balao", "🎶|musica notas",
    ],
  },
];

export const EMOJI_MAX_RECENTS = 24;
