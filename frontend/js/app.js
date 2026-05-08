// 1. CONFIGURAÇÕES E DADOS
window.configuracoesGestor = { taxaEntrega: 7.00 };

// A lista começa vazia. O Firebase vai preencher isso magicamente!
window.produtos = [];
let carrinho = [];

// 2. RENDERIZAÇÃO DO CARDÁPIO COM CATEGORIAS
const menuContainer = document.getElementById('menu-container');

window.renderizarCardapio = function() {
    const barraCat = document.getElementById('barra-categorias');
    menuContainer.innerHTML = ''; 
    barraCat.innerHTML = ''; // Limpa a barra de categorias
    menuContainer.className = ''; 

    // SE A INTERNET ESTIVER LENDO O FIREBASE, MOSTRA OS FANTASMAS (SKELETON)
    if(window.produtos.length === 0) {
        let fantasmasHTML = '<div class="menu-grid-premium" style="margin-top: 20px;">';
        // Desenha 4 cartões falsos para preencher a tela
        for(let i=0; i<4; i++) {
            fantasmasHTML += `
                <div class="card-skeleton">
                    <div class="skel-info">
                        <div class="skeleton skel-title"></div>
                        <div>
                            <div class="skeleton skel-desc"></div>
                            <div class="skeleton skel-desc-short"></div>
                        </div>
                        <div class="skeleton skel-price"></div>
                    </div>
                    <div class="skeleton skel-img"></div>
                </div>
            `;
        }
        fantasmasHTML += '</div>';
        menuContainer.innerHTML = fantasmasHTML;
        return;
    }

    // 1. AGRUPAR OS PRODUTOS POR CATEGORIA
    const categoriasAgrupadas = {};
    window.produtos.forEach(produto => {
        const cat = produto.categoria || 'Hamburguers'; 
        if (!categoriasAgrupadas[cat]) categoriasAgrupadas[cat] = [];
        categoriasAgrupadas[cat].push(produto);
    });

    // 2. ORDEM DE EXIBIÇÃO
    const ordemDesejada = ["Hamburguers", "Sanduíches", "Porções", "Bebidas", "Sobremesas"];
    const categoriasOrdenadas = Object.keys(categoriasAgrupadas).sort((a, b) => {
        let indexA = ordemDesejada.indexOf(a); let indexB = ordemDesejada.indexOf(b);
        if(indexA === -1) indexA = 99; if(indexB === -1) indexB = 99;
        return indexA - indexB;
    });

    // 3. DESENHAR BOTÕES NA NAV E AS SECÇÕES NO MENU
    categoriasOrdenadas.forEach((categoriaNome, index) => {
        // Cria botão na barra de categorias
        const btn = document.createElement('button');
        btn.className = `btn-cat ${index === 0 ? 'ativo' : ''}`;
        btn.innerText = categoriaNome;
        btn.onclick = () => {
            // Remove 'ativo' de todos e coloca no clicado
            document.querySelectorAll('.btn-cat').forEach(b => b.classList.remove('ativo'));
            btn.classList.add('ativo');
            // Scroll suave até a categoria
            document.getElementById(`ancora-${categoriaNome}`).scrollIntoView({ behavior: 'smooth', block: 'start' });
        };
        barraCat.appendChild(btn);

        // Cria o Título da Categoria com um ID para a âncora
        const titulo = document.createElement('h2');
        titulo.className = 'titulo-seccao';
        titulo.id = `ancora-${categoriaNome}`;
        titulo.innerText = categoriaNome;
        menuContainer.appendChild(titulo);

        // Cria a Grade de Produtos
        const grade = document.createElement('div');
        grade.className = 'menu-grid-premium';

        categoriasAgrupadas[categoriaNome].forEach(produto => {
            
            // 1. Proteção: Se o produto não tiver preço no banco, assume 0 para não dar erro
            const precoAtual = produto.preco || 0;
            
            // 2. Formata o preço base
            let textoPreco = precoAtual.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            
            // 3. Lógica do "A partir de" para preços zerados com opções de tamanho
            if (precoAtual === 0 && produto.opcoes && produto.opcoes.length > 0) {
                const menorPreco = Math.min(...produto.opcoes.map(opt => opt.preco));
                textoPreco = `<span style="font-size: 11px; font-weight: normal; margin-right: 4px;">A partir de</span>R$ ${menorPreco.toFixed(2).replace('.', ',')}`;
            }

            const fotoUrl = (produto.imagem && produto.imagem.startsWith('http')) ? produto.imagem : 'https://cdn-icons-png.flaticon.com/512/3075/3075977.png';
            
            grade.innerHTML += `
                <div class="card-premium" onclick="abrirModalProduto(${produto.idProduto})">
                    <div class="card-prem-info">
                        <div>
                            <h3 class="card-prem-titulo">${produto.nome}</h3>
                            <p class="card-prem-desc">${produto.ingredientes ? produto.ingredientes.join(', ') : 'Sem descrição'}</p>
                        </div>
                        <span class="card-prem-preco" style="display: flex; align-items: center;">${textoPreco}</span>
                    </div>
                    <div class="card-prem-img-box">
                        <img src="${fotoUrl}" alt="Foto" class="card-prem-img">
                    </div>
                </div>
            `;
        });
        menuContainer.appendChild(grade);
    });
}

// Inicia a renderização inicial
renderizarCardapio();

// --- LÓGICA: SCROLL SPY (ESTILO IFOOD REFINADO) ---
// --- NOVA LÓGICA: SCROLL SPY (BLINDADA CONTRA MAIÚSCULAS E MINÚSCULAS) ---
window.espiãoDeScroll = function() {
    let categoriaAtual = '';
    const titulos = document.querySelectorAll('.titulo-seccao');
    const botoes = document.querySelectorAll('.btn-cat');
    
    if(titulos.length === 0) return;
    
    // O gatilho agora é o meio da tela (mais rápido e natural para a leitura)
    const pontoDeVisao = window.innerHeight / 2; 

    // Descobre qual título de categoria cruzou o ponto de visão
    titulos.forEach(titulo => {
        const rect = titulo.getBoundingClientRect();
        if (rect.top <= pontoDeVisao) {
            // Pega o texto e transforma tudo em minúsculo para não haver confusão
            categoriaAtual = titulo.innerText.trim().toLowerCase();
        }
    });

    // Se estivermos bem no topo, força a primeira categoria
    if (window.scrollY < 50 && titulos.length > 0) {
        categoriaAtual = titulos[0].innerText.trim().toLowerCase();
    }

    // Se encontrou uma categoria, atualiza a barra lá em cima
    if(categoriaAtual !== '') {
        botoes.forEach(botao => {
            // Compara os textos todos em minúsculas!
            if (botao.innerText.trim().toLowerCase() === categoriaAtual && !botao.classList.contains('ativo')) {
                // Remove o brilho de todos
                botoes.forEach(b => b.classList.remove('ativo'));
                // Coloca o brilho no atual
                botao.classList.add('ativo');
                // Faz a barra rolar sozinha para a direita/esquerda para focar no botão
                botao.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
            }
        });
    }
};

// Liga o espião ao movimento da tela do cliente
window.addEventListener('scroll', window.espiãoDeScroll);

// ==========================================
// 3. LÓGICA DO MODAL DE PRODUTO (ADICIONAIS)
let produtoSelecionado = null;

window.abrirModalProduto = function(id) {
    produtoSelecionado = window.produtos.find(p => p.idProduto === id);
    if(!produtoSelecionado) return;

    const fotoUrl = (produtoSelecionado.imagem && produtoSelecionado.imagem.startsWith('http')) ? produtoSelecionado.imagem : 'https://cdn-icons-png.flaticon.com/512/3075/3075977.png';
    
    document.getElementById('prod-emoji').innerHTML = `<img src="${fotoUrl}" alt="Foto">`;
    document.getElementById('prod-nome').innerText = produtoSelecionado.nome;
    document.getElementById('prod-ingredientes').innerText = produtoSelecionado.ingredientes ? produtoSelecionado.ingredientes.join(", ") : "";
    document.getElementById('prod-obs').value = "";

    const listaAdicionais = document.getElementById('lista-adicionais');
    listaAdicionais.innerHTML = "";
    
    // --- NOVO: GERAR TAMANHOS (ESCOLHA ÚNICA) ---
    if(produtoSelecionado.opcoes && produtoSelecionado.opcoes.length > 0) {
        let htmlOpcoes = `<h4 style="margin-bottom: 12px; color: #fff;">Escolha o Tamanho</h4><div class="grupo-opcoes">`;
        produtoSelecionado.opcoes.forEach((opt, i) => {
            htmlOpcoes += `
                <label class="opcao-radio">
                    <div class="opcao-info">
                        <span class="opcao-nome">${opt.nome}</span>
                        <span class="opcao-preco">+ ${opt.preco.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</span>
                    </div>
                    <input type="radio" name="opcao-base" value="${opt.preco}" data-nome="${opt.nome}" ${i === 0 ? 'checked' : ''} onchange="atualizarPrecoModal()">
                </label>`;
        });
        htmlOpcoes += `</div>`;
        listaAdicionais.innerHTML = htmlOpcoes;
    }

    // --- ADICIONAIS (MÚLTIPLA ESCOLHA) ---
    if(produtoSelecionado.adicionais && produtoSelecionado.adicionais.length > 0) {
        listaAdicionais.innerHTML += `<h4 style="margin-bottom: 12px; color: #fff; border-top: 1px solid #333; pt-15px; margin-top: 10px;">Adicionais</h4>`;
        produtoSelecionado.adicionais.forEach((add, index) => {
            listaAdicionais.innerHTML += `
                <div class="item-adicional" style="margin-bottom: 8px;">
                    <label for="add-${index}">${add.nome} (+ R$ ${add.preco.toFixed(2).replace('.',',')})</label>
                    <input type="checkbox" id="add-${index}" data-preco="${add.preco}" data-nome="${add.nome}" onchange="atualizarPrecoModal()">
                </div>`;
        });
    }

    document.getElementById('produto-overlay').style.display = 'block';
    setTimeout(() => { document.getElementById('modal-produto').classList.add('aberto'); }, 10);
    atualizarPrecoModal();
    document.getElementById('btn-add-carrinho-final').onclick = confirmarAdicaoAoCarrinho;
}

window.atualizarPrecoModal = function() {
    if (!produtoSelecionado) return; 
    
    // 1. Preço inicial (ou o base do produto, ou o do tamanho selecionado)
    let total = produtoSelecionado.preco;
    const radioOpcao = document.querySelector('input[name="opcao-base"]:checked');
    if(radioOpcao) {
        total = parseFloat(radioOpcao.value);
    }
    
    // 2. Soma os adicionais
    const checkboxes = document.querySelectorAll('#lista-adicionais input[type="checkbox"]:checked');
    checkboxes.forEach(cb => { 
        total += parseFloat(cb.getAttribute('data-preco')); 
    });
    
    document.getElementById('prod-preco-total').innerText = total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

window.fecharModalProduto = function() {
    // Animação de Fechar o Bottom Sheet
    document.getElementById('modal-produto').classList.remove('aberto');
    setTimeout(() => { document.getElementById('produto-overlay').style.display = 'none'; }, 300);
}

function confirmarAdicaoAoCarrinho() {
    const adicionaisEscolhidos = [];
    let precoBase = produtoSelecionado.preco; // Preço padrão do lanche
    let precoAdicionais = 0;

    // 1. Verifica se tem TAMANHO selecionado (Os botões redondos)
    const radioOpcao = document.querySelector('input[name="opcao-base"]:checked');
    if(radioOpcao) {
        precoBase = parseFloat(radioOpcao.value);
        adicionaisEscolhidos.push("Tamanho: " + radioOpcao.getAttribute('data-nome')); // Coloca o tamanho no recibo!
    }

    // 2. Verifica os ADICIONAIS (As caixinhas quadradas) - Agora ele só procura checkboxes!
    const checkboxes = document.querySelectorAll('#lista-adicionais input[type="checkbox"]:checked');
    checkboxes.forEach(cb => {
        adicionaisEscolhidos.push(cb.getAttribute('data-nome'));
        precoAdicionais += parseFloat(cb.getAttribute('data-preco'));
    });

    const obsDoCliente = document.getElementById('prod-obs').value.trim();
    
    // 3. A Matemática final corrigida
    const precoFinalItem = precoBase + precoAdicionais; 

    carrinho.push({
        idUnico: Date.now(), 
        idProdutoOriginal: produtoSelecionado.idProduto,
        nome: produtoSelecionado.nome + (adicionaisEscolhidos.length > 0 ? " (Personalizado)" : ""),
        preco: precoFinalItem,
        quantidade: 1,
        obs: obsDoCliente,
        listaAdicionais: adicionaisEscolhidos 
    });

    atualizarTelaCarrinho();
    fecharModalProduto();
}

// 4. LÓGICA DO CARRINHO
window.removerDoCarrinho = function(index) {
    carrinho.splice(index, 1);
    atualizarTelaCarrinho();
}

function atualizarTelaCarrinho() {
    const containerItens = document.getElementById('itens-carrinho');
    const elementoTotal = document.getElementById('valor-total');
    
    // Elementos do Botão Flutuante e do Rastreador
    const btnFlutuante = document.getElementById('btn-flutuante-carrinho');
    const flutuanteQtd = document.getElementById('flutuante-qtd');
    const flutuanteTotal = document.getElementById('flutuante-total');
    const rastreador = document.getElementById('rastreador-integrado');
    
    containerItens.innerHTML = '';
    let valorTotalCalculado = 0;
    let quantidadeTotalItens = 0;

    // SE O CARRINHO ESTIVER VAZIO
    if (carrinho.length === 0) {
        containerItens.innerHTML = `<p style="text-align: center; color: var(--text-secondary); margin-top: 20px;">Seu carrinho está vazio.</p>`;
        elementoTotal.innerText = 'R$ 0,00';
        
        // Esconde o botão flutuante e DESCE o rastreador (remove a classe)
        if(btnFlutuante) btnFlutuante.classList.add('btn-flutuante-oculto');
        if(rastreador) rastreador.classList.remove('elevado'); 
        return; 
    }

    // SE O CARRINHO TIVER ITENS
    carrinho.forEach((item, index) => {
        const subtotal = item.preco * item.quantidade;
        valorTotalCalculado += subtotal; 
        quantidadeTotalItens += item.quantidade;
        
        const precoFormatado = subtotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        let htmlObs = item.obs ? `<div style="font-size: 0.75rem; color: #888; margin-top: 4px;">Obs: ${item.obs}</div>` : '';

        containerItens.innerHTML += `
            <div class="item-carrinho" style="flex-direction: column; align-items: flex-start;">
                <div style="display: flex; justify-content: space-between; width: 100%;">
                    <div class="item-carrinho-info" style="font-weight: bold;">
                        ${item.quantidade}x ${item.nome}
                    </div>
                    <div class="item-carrinho-preco" style="display: flex; gap: 10px; align-items: center;">
                        ${precoFormatado}
                        <button class="btn-editar" onclick="editarItemCarrinho(${index})" title="Editar Lanche" style="background: none; border: none; font-size: 18px; cursor: pointer; padding: 0;">✏️</button>
                        <button class="btn-remover" onclick="removerDoCarrinho(${index})" title="Remover" style="background: none; border: none; font-size: 18px; cursor: pointer; padding: 0;">🗑️</button>
                    </div>
                </div>
                ${htmlObs}
            </div>
        `;
    });

    const totalFormatado = valorTotalCalculado.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    elementoTotal.innerText = totalFormatado;

    // Mostra o botão flutuante e SOBE o rastreador (adiciona a classe)
    if(btnFlutuante) {
        btnFlutuante.classList.remove('btn-flutuante-oculto');
        flutuanteQtd.innerText = quantidadeTotalItens;
        flutuanteTotal.innerText = totalFormatado;
        if(rastreador) rastreador.classList.add('elevado');
    }
}

// 5. CHECKOUT E PAGAMENTO
window.abrirCarrinho = function() {
    document.getElementById('carrinho').classList.add('aberto');
    document.getElementById('carrinho-overlay').style.display = 'block';
}

window.fecharCarrinho = function() {
    document.getElementById('carrinho').classList.remove('aberto');
    document.getElementById('carrinho-overlay').style.display = 'none';
}

window.finalizarPedido = function() {
    if (carrinho.length === 0) {
        alert("Adicione itens ao carrinho primeiro!");
        return;
    }
    
    // 1. Abrimos o modal de checkout primeiro para garantir a continuidade
    document.getElementById('checkout-modal').style.display = 'flex';
    atualizarResumoModal(); 

    // 2. Fechamos apenas a gaveta lateral do carrinho (a animação de deslizar)
    document.getElementById('carrinho').classList.remove('aberto');
}

window.fecharModal = function() {
    // Quando fechamos o modal no "X", aí sim limpamos tudo
    document.getElementById('checkout-modal').style.display = 'none';
    
    // Escondemos o overlay de fundo aqui
    document.getElementById('carrinho-overlay').style.display = 'none';
}

window.mudarTipoPedido = function() {
    const tipo = document.getElementById('tipo-pedido').value;
    const grupoEndereco = document.getElementById('grupo-endereco');
    grupoEndereco.style.display = (tipo === 'entrega') ? 'flex' : 'none';
    atualizarResumoModal(); 
}

function atualizarResumoModal() {
    const tipoPedido = document.getElementById('tipo-pedido').value;
    const modalSubtotal = document.getElementById('modal-subtotal');
    const modalTaxa = document.getElementById('modal-taxa');
    const modalTotal = document.getElementById('modal-total-final');
    const divTaxa = document.getElementById('div-taxa-entrega');

    let subtotalTexto = document.getElementById('valor-total').innerText;
    let subtotalFinal = parseFloat(subtotalTexto.replace('R$', '').trim().replace(/\./g, '').replace(',', '.'));
    if (isNaN(subtotalFinal)) subtotalFinal = 0; 

    let taxa = (tipoPedido === 'entrega') ? window.configuracoesGestor.taxaEntrega : 0;
    divTaxa.style.display = (tipoPedido === 'entrega') ? 'flex' : 'none';

    let totalGeral = subtotalFinal + taxa;

    modalSubtotal.innerText = subtotalFinal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    modalTaxa.innerText = taxa.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    modalTotal.innerText = totalGeral.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// --- FUNÇÃO PARA MOSTRAR/ESCONDER O TROCO ---
window.verificarOpcaoTroco = function() {
    const pagamento = document.getElementById('forma-pagamento').value;
    const divTroco = document.getElementById('grupo-troco');
    
    if (pagamento === 'pagar-na-entrega') {
        divTroco.style.display = 'flex';
    } else {
        divTroco.style.display = 'none';
        document.getElementById('cliente-troco').value = ''; // Limpa se o cliente mudar de ideia
    }
}

window.prepararPagamento = async function() {
    const nomeInput = document.getElementById('cliente-nome').value;
    const whatsappInput = document.getElementById('cliente-whatsapp').value.trim();
    const tipoPedido = document.getElementById('tipo-pedido').value;
    const formaPagamento = document.getElementById('forma-pagamento').value;
    
    // --- LÓGICA DO TROCO INJETADA NAS OBSERVAÇÕES ---
    let obsInput = document.getElementById('cliente-obs').value.trim();
    let trocoInput = document.getElementById('cliente-troco') ? document.getElementById('cliente-troco').value.trim() : '';
    
    if (formaPagamento === 'pagar-na-entrega' && trocoInput !== '') {
        const avisoTroco = `🚨 LEVAR TROCO PARA R$ ${trocoInput}`;
        obsInput = obsInput ? `${avisoTroco} | ${obsInput}` : avisoTroco;
    }
    // ------------------------------------------------
    
    if(nomeInput.trim() === '' || whatsappInput === '') { return alert("Por favor, preencha o seu nome e WhatsApp!"); }

    let enderecoFormatado = 'Não se aplica';
    if (tipoPedido === 'entrega') {
        const rua = document.getElementById('cliente-rua').value;
        const num = document.getElementById('cliente-numero').value;
        const bairro = document.getElementById('cliente-bairro').value;
        if (!rua || !num || !bairro) { return alert("Preencha o endereço completo para entrega!"); }
        enderecoFormatado = `${rua}, ${num} - ${bairro}`;
    }

    // Salva o pedido temporariamente na memória
    window.pacotePedidoAtual = {
        cliente: nomeInput,
        whatsapp: whatsappInput,
        tipo: tipoPedido,
        endereco: enderecoFormatado,
        pagamento: formaPagamento,
        observacoes: obsInput.trim() || "Nenhuma",
        subtotal: document.getElementById('modal-subtotal').innerText,
        taxaEntrega: document.getElementById('modal-taxa').innerText,
        totalGeral: document.getElementById('modal-total-final').innerText,
        itens: carrinho
    };

    if (formaPagamento === 'pix-manual') {
        // --- 🔴 ATENÇÃO: COLOQUE AQUI OS SEUS DADOS BANCÁRIOS REAIS 🔴 ---
        const CHAVE_PIX = "65.687.354/0001-00"; // Sua chave Pix (CPF, CNPJ, Celular ou Email)
        const NOME_TITULAR = "CAREN SAIURI SILVA FIGUEIREDO"; // Seu nome como aparece no banco (Sem acentos)
        const CIDADE = "Cruzeiro do Sul"; // Cidade da sua conta bancária (Sem acentos)
        // ----------------------------------------------------------------

        const valorFormatado = parseFloat(document.getElementById('modal-total-final').innerText.replace('R$', '').trim().replace('.', '').replace(',', '.'));
        
        // Gera o BR Code oficial com o valor travado
        const codigoPronto = gerarPayloadPix(CHAVE_PIX, NOME_TITULAR, CIDADE, valorFormatado);
        
        document.getElementById('codigo-pix-copia-cola').innerText = codigoPronto;
        document.getElementById('pix-valor-tela').innerText = document.getElementById('modal-total-final').innerText;
        
        document.getElementById('checkout-modal').style.display = 'none';
        document.getElementById('modal-pix').style.display = 'flex';
    } else {
        // Se for maquininha ou dinheiro, o pedido vai direto pra cozinha!
        finalizarEnvioNuvem();
    }
}

// ----------------------------------------------------------------
// FUNÇÕES AUXILIARES DA TELA DE PIX E ENVIO
// ----------------------------------------------------------------

window.copiarCodigoPix = function() {
    const textoPix = document.getElementById('codigo-pix-copia-cola').innerText;
    navigator.clipboard.writeText(textoPix).then(() => {
        alert("✅ Código Pix copiado! Abra o app do seu banco, escolha 'Pix Copia e Cola' e faça o pagamento.");
    });
}

window.fecharModalPix = function() {
    document.getElementById('modal-pix').style.display = 'none';
    document.getElementById('checkout-modal').style.display = 'flex';
}

window.confirmarEnvioPix = function() {
    // Dispara o pedido pra nuvem e depois abre o WhatsApp da hamburgueria!
    finalizarEnvioNuvem(true); 
}

window.finalizarEnvioNuvem = async function(abrirWhatsApp = false) {
    const btnConfirmar = document.querySelector('.btn-confirmar');
    if(btnConfirmar) { btnConfirmar.innerText = "⏳ A processar..."; btnConfirmar.disabled = true; }

    if(typeof window.enviarPedidoParaNuvem === "function") {
        const resposta = await window.enviarPedidoParaNuvem(window.pacotePedidoAtual);
        if (resposta.sucesso) {
            localStorage.setItem('meu_ultimo_pedido', resposta.idPedido);
            carrinho = [];
            atualizarTelaCarrinho();
            
            document.getElementById('checkout-modal').style.display = 'none';
            if(document.getElementById('modal-pix')) document.getElementById('modal-pix').style.display = 'none';
            document.getElementById('carrinho-overlay').style.display = 'none'; // Fecha o fundo escuro
            
            window.iniciarRastreador();

            if(abrirWhatsApp) {
                // --- 🔴 ATENÇÃO: COLOQUE O NÚMERO DO WHATSAPP DA SUA LANCHONETE AQUI 🔴 ---
                const NUMERO_LANCHONETE = "556899106457"; // Coloque 55 + DDD + Numero
                const textoZap = `✅ *NOVO PIX ENVIADO*\n\nPedido: #${resposta.idPedido.substring(0,6).toUpperCase()}\nCliente: ${window.pacotePedidoAtual.cliente}\nValor: ${window.pacotePedidoAtual.totalGeral}\n\n*Abaixo enviarei o comprovante:*`;
                const linkZap = `https://api.whatsapp.com/send?phone=${NUMERO_LANCHONETE}&text=${encodeURIComponent(textoZap)}`;
                window.open(linkZap, '_blank');
            }
        } else {
            alert("Ops! Erro ao ligar ao servidor.");
        }
    }
}

// O MATEMÁTICO: ALGORITMO OFICIAL DO BANCO CENTRAL DO BRASIL (BR CODE)
function gerarPayloadPix(chave, nome, cidade, valor) {
    chave = chave.trim(); 
    nome = nome.trim().substring(0,25).normalize("NFD").replace(/[\u0300-\u036f]/g, ""); 
    cidade = cidade.trim().substring(0,15).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    
    let payload = [
        "000201",
        "26" + ("0014br.gov.bcb.pix01" + chave.length.toString().padStart(2, '0') + chave).length.toString().padStart(2, '0') + "0014br.gov.bcb.pix01" + chave.length.toString().padStart(2, '0') + chave,
        "52040000",
        "5303986",
        "54" + valor.toFixed(2).length.toString().padStart(2, '0') + valor.toFixed(2),
        "5802BR",
        "59" + nome.length.toString().padStart(2, '0') + nome,
        "60" + cidade.length.toString().padStart(2, '0') + cidade,
        "62070503***",
        "6304"
    ].join('');

    let crc = 0xFFFF;
    for (let c = 0; c < payload.length; c++) {
        crc ^= payload.charCodeAt(c) << 8;
        for (let i = 0; i < 8; i++) {
            if (crc & 0x8000) crc = (crc << 1) ^ 0x1021;
            else crc = crc << 1;
        }
    }
    return payload + (crc & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
}

// ==========================================
// 6. MOTOR DE BUSCA (BARRA DE PESQUISA INTELIGENTE)
window.filtrarCardapio = function() {
    const inputPesquisa = document.getElementById('input-pesquisa');
    if(!inputPesquisa) return;

    const textoLimpo = inputPesquisa.value.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, "");
    const termosPesquisa = textoLimpo.split(/\s+/);
    
    const titulosCategorias = document.querySelectorAll('.titulo-seccao');
    const gradesDeProdutos = document.querySelectorAll('.menu-grid-premium');
    
    // Pega a barra de navegação rolável lá do topo
    const barraCategorias = document.getElementById('barra-categorias'); 

    // Se o cliente digitou algo, esconde a barra superior para não confundir
    if (barraCategorias) {
        barraCategorias.style.display = textoLimpo !== "" ? 'none' : 'flex'; 
    }

    gradesDeProdutos.forEach((grade, index) => {
        const cartoes = grade.querySelectorAll('.card-premium');
        let temLancheVisivel = false;

        cartoes.forEach(cartao => {
            const elTitulo = cartao.querySelector('.card-prem-titulo');
            const elDesc = cartao.querySelector('.card-prem-desc');
            
            const tituloLanche = elTitulo ? elTitulo.textContent.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, "") : "";
            const descLanche = elDesc ? elDesc.textContent.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, "") : "";
            
            let corresponde = false;
            if (textoLimpo === "") {
                corresponde = true;
            } else {
                // Filtra espaços vazios e obriga a ter todas as palavras digitadas
                const termosValidos = termosPesquisa.filter(t => t !== "");
                corresponde = termosValidos.every(termo => tituloLanche.includes(termo) || descLanche.includes(termo));
            }
            
            if(corresponde) {
                cartao.style.display = ''; 
                temLancheVisivel = true;
            } else {
                cartao.style.display = 'none';
            }
        });

        if(temLancheVisivel) {
            // A MÁGICA: Se estiver a pesquisar, esconde o título "Hamburguers/Porções"
            if(titulosCategorias[index]) {
                titulosCategorias[index].style.display = textoLimpo !== "" ? 'none' : '';
            }
            grade.style.display = ''; 
        } else {
            if(titulosCategorias[index]) titulosCategorias[index].style.display = 'none';
            grade.style.display = 'none';
        }
    });
}

// ==========================================
// 7. LÓGICA DE EDITAR ITEM DIRETO DO CARRINHO
window.editarItemCarrinho = function(index) {
    const itemDoCarrinho = carrinho[index];
    abrirModalProduto(itemDoCarrinho.idProdutoOriginal);
    
    setTimeout(() => {
        const radiosTamanho = document.querySelectorAll('input[name="opcao-base"]');
        radiosTamanho.forEach(radio => {
            if (itemDoCarrinho.listaAdicionais.includes("Tamanho: " + radio.getAttribute('data-nome'))) {
                radio.checked = true;
            }
        });

        const checkboxes = document.querySelectorAll('#lista-adicionais input[type="checkbox"]');
        checkboxes.forEach(cb => {
            if (itemDoCarrinho.listaAdicionais.includes(cb.getAttribute('data-nome'))) {
                cb.checked = true;
            }
        });

        document.getElementById('prod-obs').value = itemDoCarrinho.obs || "";

        const btnConfirmar = document.getElementById('btn-add-carrinho-final');
        btnConfirmar.innerHTML = `Atualizar Item - <span id="prod-preco-total"></span>`;
        btnConfirmar.onclick = function() { salvarEdicaoCarrinho(index); };

        atualizarPrecoModal();
        fecharCarrinho();
    }, 50);
}

window.salvarEdicaoCarrinho = function(index) {
    const adicionaisEscolhidos = [];
    let precoBase = produtoSelecionado.preco; 
    let precoAdicionais = 0;

    const radioOpcao = document.querySelector('input[name="opcao-base"]:checked');
    if(radioOpcao) {
        precoBase = parseFloat(radioOpcao.value);
        adicionaisEscolhidos.push("Tamanho: " + radioOpcao.getAttribute('data-nome'));
    }

    const checkboxes = document.querySelectorAll('#lista-adicionais input[type="checkbox"]:checked');
    checkboxes.forEach(cb => {
        adicionaisEscolhidos.push(cb.getAttribute('data-nome'));
        precoAdicionais += parseFloat(cb.getAttribute('data-preco'));
    });

    const obsDoCliente = document.getElementById('prod-obs').value.trim();
    const precoFinalItem = precoBase + precoAdicionais; 

    carrinho[index].nome = produtoSelecionado.nome + (adicionaisEscolhidos.length > 0 ? " (Personalizado)" : "");
    carrinho[index].preco = precoFinalItem;
    carrinho[index].obs = obsDoCliente;
    carrinho[index].listaAdicionais = adicionaisEscolhidos;

    atualizarTelaCarrinho();
    fecharModalProduto();
    setTimeout(() => abrirCarrinho(), 350); 
}

window.salvarEdicaoCarrinho = function(index) {
    const adicionaisEscolhidos = [];
    let precoBase = produtoSelecionado.preco; 
    let precoAdicionais = 0;

    // Recalcula o tamanho
    const radioOpcao = document.querySelector('input[name="opcao-base"]:checked');
    if(radioOpcao) {
        precoBase = parseFloat(radioOpcao.value);
        adicionaisEscolhidos.push("Tamanho: " + radioOpcao.getAttribute('data-nome'));
    }

    // Recalcula os adicionais marcados
    const checkboxes = document.querySelectorAll('#lista-adicionais input[type="checkbox"]:checked');
    checkboxes.forEach(cb => {
        adicionaisEscolhidos.push(cb.getAttribute('data-nome'));
        precoAdicionais += parseFloat(cb.getAttribute('data-preco'));
    });

    const obsDoCliente = document.getElementById('prod-obs').value.trim();
    const precoFinalItem = precoBase + precoAdicionais; 

    // ATUALIZA o item existente na mesma posição da lista do carrinho
    carrinho[index].nome = produtoSelecionado.nome + (adicionaisEscolhidos.length > 0 ? " (Personalizado)" : "");
    carrinho[index].preco = precoFinalItem;
    carrinho[index].obs = obsDoCliente;
    carrinho[index].listaAdicionais = adicionaisEscolhidos;

    // Atualiza a tela, fecha o modal e reabre o carrinho para o cliente ver o resultado
    atualizarTelaCarrinho();
    fecharModalProduto();
    setTimeout(() => abrirCarrinho(), 350); // Reabre o carrinho de forma fluida
}