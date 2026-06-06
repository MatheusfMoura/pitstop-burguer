import { getApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, query, orderBy, onSnapshot, doc, updateDoc, addDoc, deleteDoc, setDoc, getDocs, where, increment, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";

const app = getApp();
const db = getFirestore(app);
const storage = getStorage(app); 

const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
}[char]));
const escapeAttr = escapeHTML;
const safeHttpUrl = (value, fallback = 'https://cdn-icons-png.flaticon.com/512/3075/3075977.png') => {
    try {
        const url = new URL(String(value ?? ''), window.location.origin);
        return ['http:', 'https:'].includes(url.protocol) ? url.href : fallback;
    } catch {
        return fallback;
    }
};
const safeNumber = (value, fallback = 0) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
};
const jsArg = (value) => escapeAttr(JSON.stringify(String(value ?? '')));
const stripPersonalizado = (value) => String(value ?? '').replace(' (Personalizado)', '');

// ==========================================
// 🧹 FAXINA DE IDs (RESOLVE O CONFLITO DO MODAL)
// Como agora usamos o modal na tela principal, apagamos os IDs 
// da tela antiga escondida para o sistema não se confundir!
// ==========================================
const telaAntiga = document.getElementById('tela-novo-pedido');
if (telaAntiga) {
    telaAntiga.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
}

// NAVEGAÇÃO DE TELAS E PROTEÇÃO DO CAIXA
window.mudarTela = function(nomeDaTela) {
    document.querySelectorAll('.tela').forEach(t => t.classList.remove('ativa'));
    document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('ativa'));
    
    document.getElementById('tela-' + nomeDaTela).classList.add('ativa');
    document.getElementById('btn-menu-' + nomeDaTela).classList.add('ativa');

    // Se for a tela de lançar pedido, trava a impressora. Se não, destrava e imprime a fila!
    if(nomeDaTela === 'novo-pedido') {
        window.caixaOcupado = true;
    } else {
        window.caixaOcupado = false;
        if(typeof window.liberarFilaDeImpressao === 'function') window.liberarFilaDeImpressao();
    }

    // Se clicar em Relatórios, puxa os dados do Firebase na hora!
    if(nomeDaTela === 'relatorios') {
        window.carregarDashboard();
    }
}

const whatsappBotRef = doc(db, "configuracoes", "whatsappBot");
const textosStatusWhatsApp = {
    conectado: ['Conectado', 'var(--text-green)'],
    aguardando_qr: ['Aguardando leitura do QR Code', 'var(--text-orange)'],
    autenticado: ['Autenticando...', 'var(--text-blue)'],
    iniciando: ['Iniciando...', 'var(--text-blue)'],
    reiniciando: ['Reiniciando...', 'var(--text-orange)'],
    desvinculando: ['Desvinculando...', 'var(--text-orange)'],
    desconectado: ['Desconectado', 'var(--text-red)'],
    erro_autenticacao: ['Erro de autenticação', 'var(--text-red)'],
    erro: ['Erro', 'var(--text-red)'],
    offline: ['Offline', 'var(--text-red)']
};
let ultimoStatusWhatsApp = null;

function renderizarStatusWhatsApp() {
    if(!ultimoStatusWhatsApp) return;
    const dados = ultimoStatusWhatsApp;
    const heartbeat = dados.heartbeatEm?.toDate ? dados.heartbeatEm.toDate() : null;
    const heartbeatExpirado = dados.status === 'conectado'
        && (!heartbeat || Date.now() - heartbeat.getTime() > 90000);
    const chaveStatus = heartbeatExpirado ? 'offline' : dados.status;
    const status = textosStatusWhatsApp[chaveStatus] || [chaveStatus || 'Desconhecido', 'var(--text-muted)'];
    const statusEl = document.getElementById('whatsapp-bot-status');
    const detalheEl = document.getElementById('whatsapp-bot-detalhe');
    const qrBox = document.getElementById('whatsapp-bot-qr-box');
    const qrImg = document.getElementById('whatsapp-bot-qr');

    if(statusEl) {
        statusEl.textContent = status[0];
        statusEl.style.color = status[1];
    }
    if(detalheEl) {
        const atualizado = dados.atualizadoEm?.toDate ? dados.atualizadoEm.toDate().toLocaleString('pt-BR') : 'aguardando atualização';
        detalheEl.textContent = heartbeatExpirado
            ? 'O bot parou de enviar sinais. Verifique a VPS ou reinicie o serviço.'
            : dados.erro ? `Erro: ${dados.erro}` : `Última atualização: ${atualizado}`;
    }
    if(qrBox && qrImg) {
        qrBox.style.display = dados.qrCodeDataUrl ? 'block' : 'none';
        if(dados.qrCodeDataUrl) qrImg.src = dados.qrCodeDataUrl;
    }
}

onSnapshot(whatsappBotRef, (snapshot) => {
    if (!snapshot.exists()) return;
    ultimoStatusWhatsApp = snapshot.data();
    renderizarStatusWhatsApp();
});
setInterval(renderizarStatusWhatsApp, 30000);

window.comandarWhatsAppBot = async function(tipo) {
    const mensagem = tipo === 'novo_qr'
        ? 'Isso desconectará o WhatsApp atual. Deseja gerar um novo QR Code?'
        : 'Deseja reiniciar a conexão do bot com o WhatsApp?';
    if(!confirm(mensagem)) return;

    await setDoc(whatsappBotRef, {
        comando: {
            id: crypto.randomUUID(),
            tipo,
            criadoEm: serverTimestamp()
        }
    }, { merge: true });
};

// LÓGICA DO NOVO CARDÁPIO (TELA COMPLETA)
let tempIngredientes = [];
let tempAdicionais = [];
let tempOpcoes = [];
let tempReceita = []; // MÁGICA: Memória da Ficha Técnica
let produtosNoBanco = [];
let idLancheEmEdicao = null;

const qProdutos = query(collection(db, "produtos"), orderBy("idProduto", "asc"));
onSnapshot(qProdutos, (snapshot) => {
    produtosNoBanco = [];
    const grid = document.getElementById('grid-cardapio-real');
    grid.innerHTML = '';
    
    let contador = 0;

    snapshot.forEach((docSnap) => {
        const prod = docSnap.data();
        const docId = docSnap.id;
        
        prod.idFirebase = docId; 
        produtosNoBanco.push(prod);
        contador++;

        const fotoUrl = safeHttpUrl(prod.imagem);

        let descText = (prod.ingredientes && prod.ingredientes.length > 0) ? prod.ingredientes.join(', ') : 'Ingredientes não informados.';
        if(descText.length > 65) descText = descText.substring(0, 65) + '...';
        const precoProduto = safeNumber(prod.preco);

        grid.innerHTML += `
            <div class="card-produto-real" onclick="editarProdutoReal(${jsArg(docId)})">
                <img src="${escapeAttr(fotoUrl)}" class="img-produto" alt="Foto Lanche">
                <div class="conteudo-produto">
                    <div>
                        <div class="titulo-produto">${escapeHTML(prod.nome)}</div>
                        <span style="color: var(--text-green); font-weight: bold; margin-bottom: 8px; display: block; font-size: 17px;">R$ ${precoProduto.toFixed(2).replace('.',',')}</span>
                        <div class="desc-produto" title="${escapeAttr(descText)}">${escapeHTML(descText)}</div>
                    </div>
                    <button onclick="excluirProdutoReal(event, ${jsArg(docId)})" style="background: rgba(248, 81, 73, 0.1); color: var(--text-red); border: 1px solid rgba(248, 81, 73, 0.3); padding: 8px; border-radius: 6px; cursor: pointer; font-weight: bold; width: 100%; transition: 0.2s;" onmouseover="this.style.background='var(--text-red)'; this.style.color='black';" onmouseout="this.style.background='rgba(248, 81, 73, 0.1)'; this.style.color='var(--text-red)';">🗑️ Remover Lanche</button>
                </div>
            </div>
        `;
    });
    document.getElementById('contador-lanches').innerText = `${contador} itens`;

    // --- ALIMENTA O SELECT CUSTOMIZADO DO MINI PDV (COM FOTOS PREMIUM) ---
    const listPDV = document.getElementById('pdv-options-list');
    if(listPDV) {
        listPDV.innerHTML = '';
        produtosNoBanco.forEach(p => {
            // Traz a foto oficial do lanche
            const fotoUrl = safeHttpUrl(p.imagem);
            const precoProduto = safeNumber(p.preco);
            
            listPDV.innerHTML += `
                <div class="custom-option" data-id="${escapeAttr(p.idFirebase)}" data-nome="${escapeAttr(String(p.nome ?? '').toLowerCase())}" onclick="selecionarProdutoPDV(${jsArg(p.idFirebase)}, ${jsArg(p.nome)})">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <img src="${escapeAttr(fotoUrl)}" style="width: 36px; height: 36px; border-radius: 8px; object-fit: cover; border: 1px solid rgba(255,255,255,0.1);">
                        <span class="opt-nome" style="font-size: 15px; font-weight: 600;">${escapeHTML(p.nome)}</span>
                    </div>
                    <span class="opt-preco" style="font-size: 14px;">R$ ${precoProduto.toFixed(2).replace('.',',')}</span>
                </div>
            `;
        });
    }

    // --- ALIMENTA A TELA DE ESTOQUE NO GESTOR ---
    const gridEstoque = document.getElementById('grid-estoque');
    if(gridEstoque) {
        gridEstoque.innerHTML = '';
        produtosNoBanco.forEach(p => {
            const estoqueAtual = (p.estoque !== undefined && p.estoque !== null) ? p.estoque : '';
            const badgeEsgotado = (p.estoque !== undefined && p.estoque !== null && p.estoque <= 0) ? `<span style="background: var(--soft-red); color: var(--text-red); padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold;">ESGOTADO</span>` : '';
            
            // Puxa a mesma foto cadastrada lá na aba do Cardápio!
            const fotoUrl = safeHttpUrl(p.imagem);
            
            // Salvamos a categoria invisível no cartão para o filtro ler
            const catFiltro = p.categoria || 'Outros';
            
            gridEstoque.innerHTML += `
                <div class="cartao-estoque-item" data-categoria="${escapeAttr(catFiltro)}" style="background: var(--bg-card); border: 1px solid var(--border-color); padding: 15px; border-radius: 12px; display: flex; flex-direction: column; justify-content: space-between; gap: 15px; transition: 0.2s;" onmouseover="this.style.borderColor='var(--text-blue)'" onmouseout="this.style.borderColor='var(--border-color)'">
                    <div style="display: flex; gap: 15px; align-items: center;">
                        <img src="${escapeAttr(fotoUrl)}" style="width: 65px; height: 65px; object-fit: cover; border-radius: 8px; flex-shrink: 0; border: 1px solid #444; background: #222;">
                        <div style="flex: 1; min-width: 0;">
                            <strong style="color: white; font-size: 15px; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeAttr(p.nome)}">${escapeHTML(p.nome)}</strong>
                            <span style="font-size: 12px; color: var(--text-muted); display: block; margin-bottom: 5px;">${escapeHTML(p.categoria)}</span>
                            ${badgeEsgotado}
                        </div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 10px; width: 100%;">
                        <input type="number" id="estoque-${escapeAttr(p.idFirebase)}" class="input-padrao" style="width: 100%; flex: 1; text-align: center; padding: 10px; font-weight: bold;" placeholder="Infinito" value="${escapeAttr(estoqueAtual)}">
                        <button onclick="salvarEstoqueProduto(${jsArg(p.idFirebase)})" style="background: var(--text-blue); color: black; border: none; padding: 10px 15px; border-radius: 6px; font-weight: bold; cursor: pointer; transition: 0.2s;">Atualizar</button>
                    </div>
                </div>
            `;
        });
        
        // Garante que o filtro se mantém aplicado se a página atualizar em tempo real
        if(typeof window.filtrarEstoque === 'function') window.filtrarEstoque();
    }
});

// FUNÇÃO DE FILTRO POR CATEGORIA (NOVO)
window.filtrarEstoque = function() {
    const selectFiltro = document.getElementById('filtro-categoria-estoque');
    if(!selectFiltro) return;
    
    const categoriaSelecionada = selectFiltro.value;
    const cartoes = document.querySelectorAll('.cartao-estoque-item');
    
    cartoes.forEach(cartao => {
        if (categoriaSelecionada === 'todas') {
            cartao.style.display = 'flex'; // Volta ao normal
        } else if (cartao.getAttribute('data-categoria') === categoriaSelecionada) {
            cartao.style.display = 'flex'; // Mostra se for igual
        } else {
            cartao.style.display = 'none'; // Esconde o resto
        }
    });
}

// FUNÇÃO PARA SALVAR O ESTOQUE QUANDO O GESTOR DIGITA
window.salvarEstoqueProduto = async function(idFirebase) {
    const inputEstoque = document.getElementById(`estoque-${idFirebase}`).value;
    let pacote = {};
    
    // Se deixar vazio, volta a ser "Infinito"
    if (inputEstoque === '') {
        pacote = { estoque: null }; 
    } else {
        pacote = { estoque: parseInt(inputEstoque) };
    }

    try {
        await updateDoc(doc(db, "produtos", idFirebase), pacote);
        const btn = document.querySelector(`#estoque-${idFirebase}`).nextElementSibling;
        const textoOriginal = btn.innerText;
        btn.innerText = "✅ Salvo";
        btn.style.background = "var(--text-green)";
        setTimeout(() => { btn.innerText = textoOriginal; btn.style.background = "var(--text-blue)"; }, 1500);
    } catch(e) { alert("Erro ao salvar estoque: " + e); }
}

// Verifica se deve mostrar a caixa de Tamanhos baseando-se na Categoria
window.verificarCategoriaTamanhos = function() {
    const categoria = document.getElementById('form-categoria').value;
    const boxTamanhos = document.getElementById('box-builder-tamanhos');
    if(boxTamanhos) {
        // Se a categoria for "Porções", mostra a caixa. Senão, esconde!
        boxTamanhos.style.display = (categoria === 'Porções') ? 'block' : 'none';
    }
}

window.editarProdutoReal = function(docId) {
    const prod = produtosNoBanco.find(p => p.idFirebase === docId);
    if(!prod) return;

    idLancheEmEdicao = docId;

    document.getElementById('form-nome').value = prod.nome || '';
    document.getElementById('form-preco').value = prod.preco || '';
    document.getElementById('form-img').value = prod.imagem || '';
    document.getElementById('form-categoria').value = prod.categoria || 'Hamburguers';
    window.verificarCategoriaTamanhos(); // <--- Gatilho Automático!

    tempIngredientes = prod.ingredientes ? [...prod.ingredientes] : [];
    tempAdicionais = prod.adicionais ? [...prod.adicionais] : [];
    tempOpcoes = prod.opcoes ? [...prod.opcoes] : [];
    tempReceita = prod.receita ? [...prod.receita] : []; // Carrega Ficha Técnica
    renderizarListasTemp();

    document.getElementById('titulo-form-lanche').innerText = "✏️ Editando: " + prod.nome;
    document.getElementById('btn-salvar-lanche').style.display = 'none';
    document.getElementById('btn-atualizar-lanche').style.display = 'block';
    document.getElementById('btn-cancelar-edicao').style.display = 'block';
}

window.cancelarEdicao = function() {
    idLancheEmEdicao = null;
    
    document.getElementById('form-categoria').value = 'Hamburguers';
    window.verificarCategoriaTamanhos(); // <--- Gatilho Automático!
    document.getElementById('form-nome').value = '';
    document.getElementById('form-preco').value = '';
    document.getElementById('form-img').value = '';
    tempIngredientes = [];
    tempAdicionais = [];
    tempOpcoes = [];
    tempReceita = []; // Limpa Ficha Técnica
    renderizarListasTemp();

    document.getElementById('titulo-form-lanche').innerText = "✨ Novo Lanche";
    document.getElementById('btn-salvar-lanche').style.display = 'block';
    document.getElementById('btn-atualizar-lanche').style.display = 'none';
    document.getElementById('btn-cancelar-edicao').style.display = 'none';
}

window.salvarEdicaoReal = async function() {
    const nome = document.getElementById('form-nome').value;
    const preco = parseFloat(document.getElementById('form-preco').value.replace(',', '.'));
    const imgFinal = document.getElementById('form-img').value.trim().replace(/['"]/g, '');
    const categoriaEscolhida = document.getElementById('form-categoria').value; 

    if(!nome || isNaN(preco)) return alert("⚠️ Nome e Preço são obrigatórios!");

    const dadosAtualizados = {
        nome: nome,
        preco: preco,
        imagem: imgFinal, 
        categoria: categoriaEscolhida, 
        ingredientes: [...tempIngredientes],
        adicionais: [...tempAdicionais],
        opcoes: [...tempOpcoes],
        receita: [...tempReceita] // Salva a Receita!
    };

    try {
        await updateDoc(doc(db, "produtos", idLancheEmEdicao), dadosAtualizados);
        alert("✏️ Lanche atualizado com sucesso!");
        cancelarEdicao(); 
    } catch(erro) { alert("Erro ao atualizar: " + erro); }
}

window.salvarNovoLanche = async function() {
    const nome = document.getElementById('form-nome').value;
    const preco = parseFloat(document.getElementById('form-preco').value.replace(',', '.'));
    const imgFinal = document.getElementById('form-img').value.trim().replace(/['"]/g, '');
    const categoriaEscolhida = document.getElementById('form-categoria').value; 

    if(!nome || isNaN(preco)) return alert("⚠️ Nome e Preço são obrigatórios!");

    let maxId = 0;
    produtosNoBanco.forEach(p => { if(p.idProduto > maxId) maxId = p.idProduto; });

    const novoProduto = {
        idProduto: maxId + 1,
        nome: nome,
        preco: preco,
        imagem: imgFinal,
        categoria: categoriaEscolhida, 
        ingredientes: [...tempIngredientes],
        adicionais: [...tempAdicionais],
        opcoes: [...tempOpcoes],
        receita: [...tempReceita] // Salva a Receita!
    };

    try {
        await addDoc(collection(db, "produtos"), novoProduto);
        cancelarEdicao(); 
        alert("🍔 Lanche publicado no site com sucesso!");
    } catch(erro) { alert("Erro: " + erro); }
}

window.excluirProdutoReal = async function(event, docId) {
    event.stopPropagation(); 
    if(confirm("Tem certeza? O lanche vai sumir do celular do cliente imediatamente.")) {
        await deleteDoc(doc(db, "produtos", docId));
        if(idLancheEmEdicao === docId) cancelarEdicao();
    }
}

window.adicionarIngredienteTemp = function() {
    const val = document.getElementById('in-ingrediente').value.trim();
    if(val) {
        tempIngredientes.push(val);
        document.getElementById('in-ingrediente').value = '';
        renderizarListasTemp();
    }
}

window.adicionarAdicionalTemp = function() {
    const nome = document.getElementById('in-add-nome').value.trim();
    const preco = parseFloat(document.getElementById('in-add-preco').value.replace(',', '.'));
    if(nome && !isNaN(preco)) {
        tempAdicionais.push({ nome: nome, preco: preco });
        document.getElementById('in-add-nome').value = '';
        document.getElementById('in-add-preco').value = '';
        renderizarListasTemp();
    }
}

window.adicionarOpcaoTemp = function() {
    const nome = document.getElementById('in-opt-nome').value.trim();
    const preco = parseFloat(document.getElementById('in-opt-preco').value.replace(',', '.'));
    if(nome && !isNaN(preco)) {
        tempOpcoes.push({ nome: nome, preco: preco });
        document.getElementById('in-opt-nome').value = '';
        document.getElementById('in-opt-preco').value = '';
        renderizarListasTemp();
    }
}

window.adicionarInsumoReceita = function() {
    const select = document.getElementById('in-receita-insumo');
    const qtd = parseInt(document.getElementById('in-receita-qtd').value);
    const idInsumo = select.value;
    const nomeInsumo = select.options[select.selectedIndex].text;

    if(idInsumo && qtd > 0) {
        tempReceita.push({ idInsumo, nome: nomeInsumo, quantidade: qtd });
        document.getElementById('in-receita-qtd').value = '';
        renderizarListasTemp();
    }
}

window.atualizarSelectInsumosNoLanche = function() {
    const select = document.getElementById('in-receita-insumo');
    if(!select) return;
    select.innerHTML = '<option value="">Selecione um insumo...</option>';
    if (window.insumosNaMemoria && window.insumosNaMemoria.length > 0) {
        window.insumosNaMemoria.forEach(ins => {
            select.innerHTML += `<option value="${escapeAttr(ins.id)}">${escapeHTML(ins.nome)}</option>`;
        });
    }
}

window.removerItemTemp = function(tipo, index) {
    if(tipo === 'ing') tempIngredientes.splice(index, 1);
    if(tipo === 'add') tempAdicionais.splice(index, 1);
    if(tipo === 'opt') tempOpcoes.splice(index, 1);
    if(tipo === 'rec') tempReceita.splice(index, 1); // Remove Receita
    renderizarListasTemp();
}

function renderizarListasTemp() {
    const boxIng = document.getElementById('box-ingredientes-temp');
    if(boxIng) {
        boxIng.innerHTML = '';
        tempIngredientes.forEach((ing, i) => {
            boxIng.innerHTML += `<span class="tag-item">${escapeHTML(ing)} <button class="btn-remover-tag" onclick="removerItemTemp('ing', ${i})">×</button></span>`;
        });
    }

    const boxAdd = document.getElementById('box-adicionais-temp');
    if(boxAdd) { 
        boxAdd.innerHTML = '';
        tempAdicionais.forEach((add, i) => {
            boxAdd.innerHTML += `<span class="tag-item">${escapeHTML(add.nome)} (+R$${safeNumber(add.preco).toFixed(2)}) <button class="btn-remover-tag" onclick="removerItemTemp('add', ${i})">×</button></span>`;
        });
    }

    const boxOpt = document.getElementById('box-opcoes-temp');
    if(boxOpt) {
        boxOpt.innerHTML = '';
        tempOpcoes.forEach((opt, i) => {
            boxOpt.innerHTML += `<span class="tag-item" style="border-color: var(--text-orange);">${escapeHTML(opt.nome)} (R$${safeNumber(opt.preco).toFixed(2)}) <button class="btn-remover-tag" onclick="removerItemTemp('opt', ${i})">×</button></span>`;
        });
    }

    const boxRec = document.getElementById('box-receita-temp');
    if(boxRec) {
        boxRec.innerHTML = '';
        tempReceita.forEach((rec, i) => {
            boxRec.innerHTML += `<span class="tag-item" style="border-color: var(--text-blue);">${safeNumber(rec.quantidade)}x ${escapeHTML(rec.nome)} <button class="btn-remover-tag" onclick="removerItemTemp('rec', ${i})">×</button></span>`;
        });
    }
}

// CÓDIGOS ORIGINAIS DO KDS E CAIXA
let timestampAberturaCaixa = 0; 

const configRef = doc(db, "configuracoes", "loja");
onSnapshot(configRef, (docSnap) => {
    const btn = document.getElementById('btn-status-loja');
    if (docSnap.exists()) {
        const dados = docSnap.data();
        timestampAberturaCaixa = dados.aberturaCaixa || 0; 

        // Sincroniza o botão de entrega grátis
        const switchGratis = document.getElementById('switch-entrega-gratis');
        if(switchGratis) {
            switchGratis.checked = dados.entregaGratisGeral || false;
        }
        if (dados.status === 'aberto') {
            btn.innerText = '🟢 LOJA ABERTA'; btn.className = 'status-loja loja-aberta';
        } else {
            btn.innerText = '🔴 LOJA FECHADA'; btn.className = 'status-loja loja-fechada';
        }
    }
});

window.toggleLoja = async () => {
    const btn = document.getElementById('btn-status-loja');
    const novoStatus = btn.innerText.includes('ABERTA') ? 'fechado' : 'aberto';
    let dadosAtualizacao = { status: novoStatus };
    
    if (novoStatus === 'aberto') {
        if(confirm("🛒 Deseja iniciar um novo turno? O painel será zerado para os pedidos de agora.")) {
            dadosAtualizacao.aberturaCaixa = Date.now(); 
        } else {
            return; 
        }
    } else {
        if(!confirm("🛑 Deseja fechar a loja e encerrar este turno?")) return;
    }
    
    try {
        await updateDoc(configRef, dadosAtualizacao);
        window.location.reload(); 
    } catch (erro) {
        await setDoc(configRef, dadosAtualizacao);
        window.location.reload();
    }
};

document.getElementById('data-hoje').innerText = new Date().toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

window.pedidosFinalizadosIds = [];
let dadosCompletosMemoria = {}; 

window.abrirGaveta = function(id) {
    const pedido = dadosCompletosMemoria[id];
    if(!pedido) return;

    let dataPedidoFormatada = "";
    if(pedido.dataCriacao) {
        const d = new Date(pedido.dataCriacao);
        dataPedidoFormatada = d.toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'});
    }

    document.getElementById('drawer-id').innerText = `Nº ${pedido.numeroDiario.toString().padStart(3, '0')} • ⏰ ${dataPedidoFormatada}`;

    // --- LÓGICA DO WHATSAPP COM RESUMO DO PEDIDO ---
    const whatsAppLimpo = pedido.whatsapp ? pedido.whatsapp.replace(/\D/g, '') : '';
    
    let listaItensZap = "";
    if (pedido.itens && pedido.itens.length > 0) {
        listaItensZap = pedido.itens.map(item => `▪️ ${item.quantidade}x ${item.nome.replace(' (Personalizado)', '')}`).join('\n');
    }
    
    const msgZap = `Olá ${pedido.cliente}, tudo bem? Aqui é do Pitstop Burguer sobre o seu pedido *#${id.substring(0,6).toUpperCase()}*.\n\n📦 *Resumo:*\n${listaItensZap}\n\n*Total:* ${pedido.totalGeral}`;
    
    const linkWhats = whatsAppLimpo ? `https://api.whatsapp.com/send?phone=55${whatsAppLimpo}&text=${encodeURIComponent(msgZap)}` : '#';
    
    // --- LÓGICA DAS CAIXAS GIGANTES DE TIPO E PAGAMENTO ---
    let tipoTexto = "Comer no Local"; let corTipo = "var(--soft-blue)"; let corTextoTipo = "var(--text-blue)"; let iconTipo = "🍽️"; let mostraEnd = false;
    if(pedido.tipo === "entrega") { tipoTexto = "Delivery"; corTipo = "var(--soft-green)"; corTextoTipo = "var(--text-green)"; iconTipo = "🛵"; mostraEnd = true; }
    else if(pedido.tipo === "retirada") { tipoTexto = "Retirar no Balcão"; corTipo = "var(--soft-orange)"; corTextoTipo = "var(--text-orange)"; iconTipo = "🛍️"; }

    let pagTexto = pedido.pagamento; let iconPag = "💳"; let corTextoPag = "white";
    if(pagTexto === "pagar-na-entrega" || pagTexto === "dinheiro") { pagTexto = "Dinheiro no Local"; iconPag = "💵"; corTextoPag = "var(--text-orange)"; }
    else if(pagTexto === "cartao-credito") { pagTexto = "Crédito (Levar Maquineta)"; iconPag = "💳"; corTextoPag = "var(--text-blue)"; }
    else if(pagTexto === "cartao-debito") { pagTexto = "Débito (Levar Maquineta)"; iconPag = "💳"; corTextoPag = "var(--text-blue)"; }
    else if(pagTexto === "pix-app" || pagTexto === "pix-manual") { pagTexto = "Pix (Já Pago)"; iconPag = "❇️"; corTextoPag = "var(--text-green)"; }
    else if(pagTexto === "cartao-app") { pagTexto = "Cartão (App)"; iconPag = "💳"; }

    // Injetando o layout direto no nome do cliente com o botão do WhatsApp
    document.getElementById('drawer-cliente').innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
            <div style="font-size: 22px; font-weight: bold; color: white;">👤 ${escapeHTML(pedido.cliente || "Sem Nome")}</div>
            ${whatsAppLimpo ? `<a href="${escapeAttr(linkWhats)}" target="_blank" rel="noopener noreferrer" style="background: var(--soft-green); color: var(--text-green); border: 1px solid rgba(46, 160, 67, 0.4); padding: 8px 14px; border-radius: 8px; text-decoration: none; font-size: 13px; font-weight: bold; display: flex; align-items: center; gap: 6px; transition: 0.2s;" onmouseover="this.style.background='rgba(46, 160, 67, 0.3)'" onmouseout="this.style.background='var(--soft-green)'">💬 WhatsApp</a>` : ''}
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
            <div style="background: ${corTipo}; border: 1px solid ${corTextoTipo}; padding: 12px; border-radius: 8px; text-align: center;">
                <div style="font-size: 26px; margin-bottom: 5px;">${iconTipo}</div>
                <div style="font-size: 13px; font-weight: 800; color: ${corTextoTipo}; text-transform: uppercase; letter-spacing: 0.5px;">${tipoTexto}</div>
            </div>
            <div style="background: var(--bg-hover); border: 1px solid var(--border-color); padding: 12px; border-radius: 8px; text-align: center;">
                <div style="font-size: 26px; margin-bottom: 5px;">${iconPag}</div>
                <div style="font-size: 12px; font-weight: 800; color: ${corTextoPag}; text-transform: uppercase;">${pagTexto}</div>
            </div>
        </div>
    `;

    document.getElementById('drawer-tag-tipo').style.display = 'none';
    document.getElementById('drawer-tag-pag').style.display = 'none';

    // --- 5. ENDEREÇO (Destacado e CLICÁVEL 🗺️) ---
    if(mostraEnd) { 
        const linkMapa = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(pedido.endereco)}`;
        
        document.getElementById('drawer-box-endereco').style.display = "block"; 
        document.getElementById('drawer-endereco').innerHTML = `
            <a href="${escapeAttr(linkMapa)}" target="_blank" rel="noopener noreferrer" style="text-decoration: none; display: block;">
                <div style="background: rgba(46, 160, 67, 0.1); border-left: 4px solid var(--text-green); padding: 12px; border-radius: 4px; color: white; line-height: 1.5; font-size: 15px; cursor: pointer; transition: 0.2s;" onmouseover="this.style.background='rgba(46, 160, 67, 0.2)'" onmouseout="this.style.background='rgba(46, 160, 67, 0.1)'">
                    📍 ${escapeHTML(pedido.endereco)} <br>
                    <span style="font-size: 11px; color: var(--text-green); margin-top: 6px; display: inline-block; font-weight: bold;">🗺️ Clique para abrir a rota no Mapa</span>
                </div>
            </a>`; 
    } else { 
        document.getElementById('drawer-box-endereco').style.display = "none"; 
    }

    // 6. ITENS (Estilo Recibo)
    let itensHTML = '';
    if(pedido.itens) {
        pedido.itens.forEach(item => {
            let adds = (item.listaAdicionais && item.listaAdicionais.length > 0) ? `<div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">&plus; ${item.listaAdicionais.map(escapeHTML).join(', ')}</div>` : '';
            let obs = (item.obs && item.obs.trim() !== '') ? `<div style="font-size: 13px; color: var(--text-red); margin-top: 4px; font-weight: bold;">⚠️ Obs: ${escapeHTML(item.obs)}</div>` : '';
            let pco = (typeof item.preco === 'number') ? item.preco.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'}) : escapeHTML(item.preco);
            
            itensHTML += `
                <div style="background: var(--bg-main); border: 1px solid var(--border-color); padding: 12px; border-radius: 8px; margin-bottom: 10px;">
                    <div style="display: flex; justify-content: space-between; font-weight: bold; font-size: 15px; color: white;">
                        <span><span style="color: var(--text-orange); margin-right: 5px;">${safeNumber(item.quantidade, 1)}x</span> ${escapeHTML(stripPersonalizado(item.nome))}</span>
                        <span style="color: var(--text-green);">${pco}</span>
                    </div>
                    ${adds} 
                    ${obs}
                </div>`;
        });
    }
    
    if (mostraEnd && pedido.taxaEntrega && pedido.taxaEntrega !== "R$ 0,00") {
         itensHTML += `
            <div style="display: flex; justify-content: space-between; padding: 10px; font-size: 14px; color: var(--text-muted); border-top: 1px dashed var(--border-color); margin-top: 10px;">
                <span>Taxa de Entrega</span>
                <span>${escapeHTML(pedido.taxaEntrega)}</span>
            </div>`;
    }
    document.getElementById('drawer-itens').innerHTML = itensHTML || '<div class="info-text">Sem itens</div>';

    // 7. OBSERVAÇÕES GERAIS E TOTAL
    const obsGeralHtml = (pedido.observacoes && pedido.observacoes !== "Nenhuma") 
        ? `<div style="background: var(--soft-orange); color: var(--text-orange); padding: 12px; border-radius: 8px; font-weight: bold; border: 1px solid rgba(210, 153, 34, 0.4);">🚨 ${escapeHTML(pedido.observacoes)}</div>`
        : `<div style="color: var(--text-muted); font-style: italic;">Sem observações.</div>`;
    document.getElementById('drawer-obs').innerHTML = obsGeralHtml;
    
    document.getElementById('drawer-total').innerText = pedido.totalGeral;

    // 8. BOTÕES DE AÇÃO (Com a lógica do Motoboy aplicada)
    // O botão de imprimir fica sempre fixo do lado esquerdo
    let actHTML = `<button class="btn-action" style="background:#444; color:#fff; flex: 0.4;" onclick="imprimirComanda(${jsArg(id)})">🖨️ Imprimir</button>`;
    
    if(pedido.status === "Pendente") actHTML += `<button class="btn-action" style="background:var(--text-orange); color:#000;" onclick="mudarStatusFechando(${jsArg(id)}, 'Em Preparo')">👨‍🍳 Iniciar Preparo</button>`;
    else if(pedido.status === "Em Preparo") actHTML = `<button class="btn-action" style="background:var(--text-blue); color:#000;" onclick="mudarStatusFechando(${jsArg(id)}, 'Pronto')">✅ Marcar Pronto</button>`;
    
    // AQUI ENTRA A LÓGICA DE ESCOLHER O MOTOBOY (O Passo 3 Perdido)
    else if(pedido.status === "Pronto" && mostraEnd) {
        let opcoesMotoboy = '<option value="">Quem vai entregar?...</option>';
        if (typeof motoboysNoBanco !== 'undefined') {
            motoboysNoBanco.forEach(m => {
                opcoesMotoboy += `<option value="${escapeAttr(m.nome)}">${escapeHTML(m.nome)}</option>`;
            });
        }
        actHTML = `
            <select id="select-moto-${escapeAttr(id)}" style="flex: 2; padding: 10px; border-radius: 6px; background: var(--bg-main); color: white; border: 1px solid var(--border-color); font-size: 14px; outline: none;">
                ${opcoesMotoboy}
            </select>
            <button class="btn-action" style="flex: 1; background:var(--text-green); color:#000;" onclick="despacharComMotoboy(${jsArg(id)})">🛵 Despachar</button>
        `;
    }
    
    else if(pedido.status === "Pronto") actHTML = `<button class="btn-action" style="background:var(--text-purple); color:#000;" onclick="mudarStatusFechando(${jsArg(id)}, 'Finalizado')">🤝 Entregue ao Cliente</button>`;
    else if(pedido.status === "Saiu para Entrega") {
        actHTML = `
            <button class="btn-action" style="background:#25D366; color:#000;" onclick="abrirAvisoSaidaWhatsApp(${jsArg(id)})">💬 Avisar manualmente</button>
            <button class="btn-action" style="background:var(--text-purple); color:#000;" onclick="mudarStatusFechando(${jsArg(id)}, 'Finalizado')">✅ Confirmar Entrega</button>
        `;
    }
    
    document.getElementById('drawer-actions').innerHTML = actHTML;

    // Mostrar Gaveta
    document.getElementById('drawerOverlay').style.display = 'block';
    setTimeout(() => { document.getElementById('drawerOverlay').style.opacity = '1'; document.getElementById('drawerPanel').style.right = '0'; }, 10);
}

window.fecharGaveta = function() {
    document.getElementById('drawerOverlay').style.opacity = '0';
    document.getElementById('drawerPanel').style.right = '-450px';
    setTimeout(() => { document.getElementById('drawerOverlay').style.display = 'none'; }, 300);
}

window.mudarStatus = async (idDoPedido, novoStatus) => { 
    try { 
        let pacoteAtualizacao = { status: novoStatus };

        const pedidoAtual = dadosCompletosMemoria[idDoPedido];
        if (novoStatus === 'Em Preparo' && pedidoAtual?.whatsapp) {
            pacoteAtualizacao.whatsappPreparoEnviado = false;
            pacoteAtualizacao.whatsappPreparoStatus = 'pendente';
            pacoteAtualizacao.whatsappPreparoErro = null;
            if (pedidoAtual.numeroDiario) pacoteAtualizacao.numeroDiario = pedidoAtual.numeroDiario;
        }

        // --- MÁGICA: DESCONTO AUTOMÁTICO (PRODUTO + COZINHA) ---
        if (novoStatus === 'Pronto') {
            const pedido = dadosCompletosMemoria[idDoPedido];
            
            if (pedido && !pedido.estoqueDescontado && pedido.itens) {
                for (const item of pedido.itens) {
                    const produtoOriginal = produtosNoBanco.find(p => p.idProduto === item.idProdutoOriginal || p.nome === item.nome.replace(' (Personalizado)', ''));
                    
                    // 1. Desconto do Produto Final (Ex: Bebida)
                    if (produtoOriginal && produtoOriginal.idFirebase && produtoOriginal.estoque !== undefined && produtoOriginal.estoque !== null) {
                        await updateDoc(doc(db, "produtos", produtoOriginal.idFirebase), {
                            estoque: increment(-item.quantidade)
                        });
                    }

                    // 2. Desconto da FICHA TÉCNICA (Ex: Salsicha, Pão)
                    if (produtoOriginal && produtoOriginal.receita && produtoOriginal.receita.length > 0) {
                        for (const ingrediente of produtoOriginal.receita) {
                            const totalParaDescontar = ingrediente.quantidade * item.quantidade;
                            await updateDoc(doc(db, "insumos", ingrediente.idInsumo), {
                                quantidade: increment(-totalParaDescontar)
                            });
                        }
                    }
                }
                pacoteAtualizacao.estoqueDescontado = true; 
            }
        }
        // ---------------------------------------------

        await updateDoc(doc(db, "pedidos", idDoPedido), pacoteAtualizacao); 
    } catch (erro) { 
        alert("Erro ao mudar status: " + erro); 
    } 
};

window.mudarStatusFechando = async function(id, status) { 
    await window.mudarStatus(id, status); 
    fecharGaveta(); 
}

window.abrirAvisoSaidaWhatsApp = function(id) {
    const pedido = dadosCompletosMemoria[id];
    if(!pedido || !pedido.whatsapp) return alert("Pedido sem WhatsApp cadastrado.");

    const numeroLocal = String(pedido.whatsapp).replace(/\D/g, '');
    const numeroComPais = numeroLocal.startsWith('55') ? numeroLocal : `55${numeroLocal}`;
    const numeroPedido = pedido.numeroDiario
        ? String(pedido.numeroDiario).padStart(3, '0')
        : id.substring(0, 6).toUpperCase();
    const mensagem = `Olá, ${pedido.cliente || 'cliente'}! 🍽️\n\nSeu pedido #${numeroPedido} saiu para entrega.\nO entregador já está a caminho. 🛵\n\nObrigado pela preferência!\nPitstop Burguer`;

    window.open(`https://wa.me/${numeroComPais}?text=${encodeURIComponent(mensagem)}`, '_blank', 'noopener,noreferrer');
}

// FUNÇÃO PARA DESPACHAR COM O MOTOBOY SELECIONADO
window.despacharComMotoboy = async function(id) {
    const select = document.getElementById(`select-moto-${id}`);
    const nomeMotoboy = select.value;
    const pedido = dadosCompletosMemoria[id];
    
    if(!nomeMotoboy) return alert("⚠️ Selecione um motoboy na lista para poder despachar!");

    try {
        const atualizacao = {
            status: 'Saiu para Entrega',
            entregador: nomeMotoboy,
            whatsappSaiuEntregaEnviado: false,
            whatsappStatus: 'pendente',
            whatsappErro: null
        };

        if(pedido && pedido.numeroDiario) {
            atualizacao.numeroDiario = pedido.numeroDiario;
        }

        await updateDoc(doc(db, "pedidos", id), atualizacao);
        fecharGaveta();
    } catch (erro) {
        alert("Erro ao despachar: " + erro);
    }
}

// ==========================================
// 🖨️ MEMÓRIA DA IMPRESSORA AUTOMÁTICA E FILA INTELIGENTE
let pedidosJaImpressos = new Set();
let primeiraCargaDoPainel = true;

window.filaDeImpressao = [];
window.caixaOcupado = false; // A trava que impede o congelamento!

window.solicitarImpressao = function(id) {
    if (window.caixaOcupado) {
        // Se o caixa estiver a digitar um pedido, guarda na fila silenciosamente
        if(!window.filaDeImpressao.includes(id)) window.filaDeImpressao.push(id);
    } else {
        // Se o caixa estiver livre, imprime na hora
        imprimirComanda(id);
    }
}

window.liberarFilaDeImpressao = function() {
    if (window.filaDeImpressao.length > 0) {
        // Pega no pedido mais antigo retido na fila e tira-o de lá
        const idParaImprimir = window.filaDeImpressao.shift();
        imprimirComanda(idParaImprimir);
        
        // Espera 2.5 segundos e tenta imprimir o próximo para não engasgar a máquina
        setTimeout(window.liberarFilaDeImpressao, 2500);
    }
}
// ==========================================

const qPedidos = query(collection(db, "pedidos"), orderBy("dataCriacao", "asc"));
onSnapshot(qPedidos, (snapshot) => {
    document.getElementById('lista-pendente').innerHTML = ''; document.getElementById('lista-preparo').innerHTML = '';
    document.getElementById('lista-pronto').innerHTML = ''; document.getElementById('lista-entrega').innerHTML = '';
    document.getElementById('lista-finalizado').innerHTML = '';
    
    window.pedidosFinalizadosIds = []; dadosCompletosMemoria = {};
    let contagens = { pendente: 0, preparo: 0, pronto: 0, entrega: 0, finalizado: 0 };
    let totalReceitaCalculada = 0; let totalPedidosCalculados = 0;
    
    // NOVO: Liga o contador que vai zerar a cada novo turno!
    let contadorDiario = 1; 

    snapshot.forEach((documento) => {
        const pedido = documento.data(); const id = documento.id;
        
        // 🚨 FILTRO DE TURNO: Se o pedido foi feito antes do caixa abrir, ignora e pula pro próximo!
        if (pedido.dataCriacao < timestampAberturaCaixa) return; 
        
        // Carimba no pedido o número exato dele no dia e soma +1 para o próximo
        pedido.numeroDiario = contadorDiario++; 

        // ==========================================
        // 🖨️ GATILHO: SE CHEGOU PEDIDO NOVO, VAI PARA A FILA!
        // ==========================================
        if (!primeiraCargaDoPainel && (pedido.status === "Pendente" || pedido.status === "Em Preparo") && !pedidosJaImpressos.has(id)) {
            // Agora ele manda para o nosso sistema inteligente em vez de imprimir direto
            setTimeout(() => { solicitarImpressao(id); }, 1500); 
        }
        pedidosJaImpressos.add(id); 
        // ==========================================

        dadosCompletosMemoria[id] = pedido;
        
        if(pedido.totalGeral) {
            let numValor = parseFloat(pedido.totalGeral.replace('R$','').replace('.','').replace(',','.'));
            if(!isNaN(numValor)) totalReceitaCalculada += numValor;
        }
        totalPedidosCalculados++;

        let tagClass = pedido.tipo === 'entrega' ? 'entrega' : (pedido.tipo === 'local' ? 'local' : 'retirada');
        let tagTxt = pedido.tipo === 'entrega' ? 'DELIVERY' : (pedido.tipo === 'local' ? 'MESA/LOCAL' : 'RETIRADA');
        
        // Criar um resumo rápido do pedido para mostrar no cartão
        let resumoItens = "";
        if(pedido.itens && pedido.itens.length > 0) {
            let qtdTotal = 0;
            pedido.itens.forEach(i => qtdTotal += i.quantidade);
            let nomes = pedido.itens.map(i => stripPersonalizado(i.nome)).join(', ');
            if(nomes.length > 32) nomes = nomes.substring(0, 32) + '...';
            resumoItens = `<div style="font-size: 11px; color: var(--text-muted); margin-bottom: 12px; background: rgba(0,0,0,0.3); padding: 8px; border-radius: 6px;">📦 ${safeNumber(qtdTotal)} item(s): ${escapeHTML(nomes)}</div>`;
        }

        const card = document.createElement('div'); card.className = 'card-mini'; card.onclick = () => abrirGaveta(id);
        card.innerHTML = `
            <div class="card-top" style="margin-bottom: 10px;">
                <span class="tag ${tagClass}" style="padding: 4px 8px;">${tagTxt}</span>
                <span class="card-timer" style="font-size: 11px;">⏰ ${new Date(pedido.dataCriacao).toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})}</span>
            </div>
            <div class="card-client" style="font-size: 16px; margin-bottom: 8px;">${escapeHTML(pedido.cliente || 'Sem Nome')}</div>
            ${resumoItens}
            <div class="card-info" style="border-top: 1px dashed var(--border-color); padding-top: 10px; margin-top: auto;">
                <span class="card-id" style="font-weight: bold; font-size: 15px; color: var(--text-orange);">#${pedido.numeroDiario.toString().padStart(3, '0')}</span>
                <strong style="color: white; font-size: 15px;">${escapeHTML(pedido.totalGeral)}</strong>
            </div>
        `;

        if (pedido.status === "Pendente") { document.getElementById('lista-pendente').append(card); contagens.pendente++; } 
        else if (pedido.status === "Em Preparo") { document.getElementById('lista-preparo').append(card); contagens.preparo++; } 
        else if (pedido.status === "Pronto") { document.getElementById('lista-pronto').append(card); contagens.pronto++; } 
        else if (pedido.status === "Saiu para Entrega") { document.getElementById('lista-entrega').append(card); contagens.entrega++; } 
        else if (pedido.status === "Finalizado") { document.getElementById('lista-finalizado').append(card); contagens.finalizado++; window.pedidosFinalizadosIds.push(id); }
    });

    document.getElementById('metric-pedidos').innerText = totalPedidosCalculados;
    document.getElementById('metric-receita').innerText = totalReceitaCalculada.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    document.getElementById('count-pendente').innerText = contagens.pendente; document.getElementById('count-preparo').innerText = contagens.preparo;
    document.getElementById('count-pronto').innerText = contagens.pronto; document.getElementById('count-entrega').innerText = contagens.entrega;
    document.getElementById('count-finalizado').innerText = contagens.finalizado;
    
    primeiraCargaDoPainel = false; // <- AVISA O SISTEMA QUE JÁ CARREGOU OS PEDIDOS ANTIGOS
});

// GESTÃO DE MOTOBOYS
let motoboysNoBanco = [];

onSnapshot(collection(db, "motoboys"), (snapshot) => {
    const grid = document.getElementById('grid-motoboys');
    if(!grid) return;
    grid.innerHTML = '';
    motoboysNoBanco = [];

    snapshot.forEach((docSnap) => {
        const moto = docSnap.data();
        const id = docSnap.id;
        motoboysNoBanco.push({ id, ...moto });

        grid.innerHTML += `
            <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px; padding: 8px 12px; display: flex; align-items: center; gap: 10px; transition: 0.2s;">
                <div style="background: var(--soft-blue); color: var(--text-blue); width: 32px; height: 32px; border-radius: 6px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                    <span class="material-symbols-outlined" style="font-size: 18px;">directions_bike</span>
                </div>
                <div style="flex: 1; min-width: 0;">
                    <strong style="color: white; font-size: 13px; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHTML(moto.nome)}</strong>
                    <span style="font-size: 10px; color: var(--text-muted);">${escapeHTML(moto.telefone)}</span>
                </div>
                <button onclick="excluirMotoboy(${jsArg(id)})" style="background: none; border: none; color: var(--text-muted); cursor: pointer; display: flex; align-items: center; transition: 0.2s;" onmouseover="this.style.color='var(--text-red)'" onmouseout="this.style.color='var(--text-muted)'">
                    <span class="material-symbols-outlined" style="font-size: 18px;">delete</span>
                </button>
            </div>
        `;
    });
});

window.salvarMotoboy = async function() {
    const nome = document.getElementById('moto-nome').value;
    const telefone = document.getElementById('moto-fone').value;
    const placa = document.getElementById('moto-placa').value;

    if(!nome || !telefone) return alert("Nome e Telefone são obrigatórios!");

    try {
        await addDoc(collection(db, "motoboys"), {
            nome,
            telefone,
            placa,
            dataCadastro: Date.now()
        });
        alert("Motoboy autorizado com sucesso!");
        limparFormMotoboy();
    } catch (e) {
        alert("Erro ao cadastrar: " + e);
    }
}

window.limparFormMotoboy = function() {
    document.getElementById('moto-nome').value = '';
    document.getElementById('moto-fone').value = '';
    document.getElementById('moto-placa').value = '';
}

window.excluirMotoboy = async function(id) {
    if(confirm("Deseja remover a autorização deste motoboy?")) {
        await deleteDoc(doc(db, "motoboys", id));
    }
}

// DASHBOARD E RELATÓRIOS FINANCEIROS
let chartReceita = null;
let chartItens = null;

window.carregarDashboard = async function() {
    // 1. Busca APENAS os pedidos Finalizados (Entregues)
    const qRelatorio = query(collection(db, "pedidos"), where("status", "==", "Finalizado"));
    const querySnapshot = await getDocs(qRelatorio);
    
    // Leitura do Filtro de Mês
    const filtroMes = document.getElementById('filtro-mes-dashboard');
    let mesSelecionado = filtroMes ? filtroMes.value : "todos";
    
    let faturamentoTotal = 0;
    let qtdPedidos = 0;
    let totalProdutosVendidos = 0; // NOVA MÉTRICA DE PRODUÇÃO
    let pedidosFinalizadosLista = []; 
    
    let contagemProdutos = {};
    let faturamentoDiarioPorCategoria = {}; 
    
    const categoriasPredefinidas = ['Hamburguers', 'Sanduíches', 'Porções', 'Bebidas', 'Sobremesas', 'Taxa de Entrega', 'Outros'];

    // Conjunto invisível para descobrir quais meses existem de verdade no banco
    let mesesDisponiveis = new Set();

    querySnapshot.forEach((docSnap) => {
        const pedido = docSnap.data();
        pedido.id = docSnap.id; 
        
        let dataFormatada = "Desconhecida";
        let chaveMesAno = "todos"; // Usado para o filtro
        
        if(pedido.dataCriacao) {
            const dataObj = new Date(pedido.dataCriacao);
            dataFormatada = `${dataObj.getDate().toString().padStart(2, '0')}/${(dataObj.getMonth()+1).toString().padStart(2, '0')}`;
            
            // Cria formato universal "YYYY-MM" (Ex: 2026-05) para filtrar perfeitamente
            chaveMesAno = `${dataObj.getFullYear()}-${(dataObj.getMonth()+1).toString().padStart(2, '0')}`;
            mesesDisponiveis.add(chaveMesAno);
        }

        // 🛑 FILTRO DE MÊS: Se o pedido não for do mês selecionado, o sistema ignora ele!
        if (mesSelecionado !== "todos" && chaveMesAno !== mesSelecionado) {
            return; 
        }

        pedidosFinalizadosLista.push(pedido);
        qtdPedidos++;

        // Cria o dia zerado se não existir
        if (!faturamentoDiarioPorCategoria[dataFormatada]) {
            faturamentoDiarioPorCategoria[dataFormatada] = {};
            categoriasPredefinidas.forEach(c => faturamentoDiarioPorCategoria[dataFormatada][c] = 0);
        }

        let numValorTotal = 0;
        if(pedido.totalGeral) {
            numValorTotal = parseFloat(pedido.totalGeral.replace('R$','').replace('.','').replace(',','.'));
            if(!isNaN(numValorTotal)) faturamentoTotal += numValorTotal;
        }

        // Desmembra os itens na sua respectiva categoria
        let somaItens = 0;
        if(pedido.itens && pedido.itens.length > 0) {
            pedido.itens.forEach(item => {
                const nomeLanche = item.nome.replace(' (Personalizado)', '');
                contagemProdutos[nomeLanche] = (contagemProdutos[nomeLanche] || 0) + item.quantidade;
                
                // ALIMENTA A NOVA MÉTRICA (Soma quantos lanches saíram da chapa)
                totalProdutosVendidos += item.quantidade; 
                
                // Descobre a categoria do item baseando-se no banco
                const produtoOriginal = produtosNoBanco.find(p => p.idProduto === item.idProdutoOriginal || p.nome === nomeLanche);
                const cat = (produtoOriginal && produtoOriginal.categoria) ? produtoOriginal.categoria : 'Outros';
                
                const subtotalItem = (item.preco * item.quantidade) || 0;
                if(faturamentoDiarioPorCategoria[dataFormatada][cat] !== undefined) {
                    faturamentoDiarioPorCategoria[dataFormatada][cat] += subtotalItem;
                } else {
                    faturamentoDiarioPorCategoria[dataFormatada]['Outros'] += subtotalItem;
                }
                somaItens += subtotalItem;
            });
        }
        
        // Extrai a Taxa de Entrega e extras matematicamente
        if(numValorTotal > somaItens) {
            const diffTaxa = numValorTotal - somaItens;
            faturamentoDiarioPorCategoria[dataFormatada]['Taxa de Entrega'] += diffTaxa;
        }
    });

    // --- MÁGICA DO SELECT AUTOMÁTICO ---
    // Popula a caixa de seleção de meses sozinhos, do mês mais recente para o mais antigo
    if (filtroMes && filtroMes.options.length <= 1 && mesesDisponiveis.size > 0) {
        let mesesArray = Array.from(mesesDisponiveis).sort().reverse(); 
        mesesArray.forEach(mes => {
            const [ano, mesNum] = mes.split('-');
            // Transforma "2026-05" em "Maio/2026"
            const nomeMes = new Date(ano, mesNum - 1, 1).toLocaleDateString('pt-BR', { month: 'long' });
            const textoOpcao = nomeMes.charAt(0).toUpperCase() + nomeMes.slice(1) + '/' + ano;
            
            filtroMes.innerHTML += `<option value="${mes}">${textoOpcao}</option>`;
        });
        
        // Na primeira vez que a página carrega, seleciona o mês atual automaticamente
        if (mesSelecionado === "todos" && mesesArray.length > 0) {
            filtroMes.value = mesesArray[0];
            return carregarDashboard(); // Recarrega a função aplicando o filtro do mês atual
        }
    }

    // 2. Atualiza os Cards com as novas métricas do mês filtrado
    document.getElementById('dash-faturamento').innerText = faturamentoTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    document.getElementById('dash-pedidos').innerText = qtdPedidos;
    document.getElementById('dash-produtos-vendidos').innerText = totalProdutosVendidos;

    // 3. Gráfico de Barras Empilhadas (Faturamento)
    const labelsDias = Object.keys(faturamentoDiarioPorCategoria).sort(); 
    
    // Paleta de Cores Premium
    const coresCategorias = {
        'Hamburguers': '#ff7b72',     // Vermelho Vivo
        'Sanduíches': '#e3b341',      // Laranja Mostarda
        'Porções': '#f0e68c',         // Amarelo Claro
        'Bebidas': '#79c0ff',         // Azul Claro
        'Sobremesas': '#d2a8ff',      // Roxo
        'Taxa de Entrega': '#56d364', // Verde 
        'Outros': '#8b949e'           // Cinza
    };

    const datasetsEmpilhados = categoriasPredefinidas.map(categoria => {
        return {
            label: categoria,
            data: labelsDias.map(dia => faturamentoDiarioPorCategoria[dia][categoria]),
            backgroundColor: coresCategorias[categoria],
            borderWidth: 0,
            borderRadius: 4
        };
    });

    // Tira as categorias vazias para não poluir a legenda à toa
    const datasetsFiltrados = datasetsEmpilhados.filter(dataset => dataset.data.some(valor => valor > 0));

    // 4. Gráfico de Rosca (Mais Vendidos)
    const arrayProdutos = Object.keys(contagemProdutos).map(nome => ({ nome, qtd: contagemProdutos[nome] }));
    arrayProdutos.sort((a, b) => b.qtd - a.qtd); 
    const top5Produtos = arrayProdutos.slice(0, 5);
    const labelsProdutos = top5Produtos.map(p => p.nome);
    const dadosProdutos = top5Produtos.map(p => p.qtd);

    // 5. Preenche a Tabela de Histórico Recente
    pedidosFinalizadosLista.sort((a, b) => b.dataCriacao - a.dataCriacao);
    const ultimos10 = pedidosFinalizadosLista.slice(0, 10);
    const tbody = document.getElementById('tabela-historico');
    tbody.innerHTML = '';
    
    if (ultimos10.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 20px; color: var(--text-muted);">Nenhum pedido finalizado ainda.</td></tr>`;
    } else {
        ultimos10.forEach(p => {
            let dataStr = "";
            if(p.dataCriacao) {
                const d = new Date(p.dataCriacao);
                dataStr = `${d.getDate().toString().padStart(2,'0')}/${(d.getMonth()+1).toString().padStart(2,'0')} às ${d.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'})}`;
            }
            tbody.innerHTML += `
                <tr style="border-bottom: 1px solid var(--border-color); transition: background 0.2s;" onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background='transparent'">
                    <td style="padding: 12px 10px; color: var(--text-muted); font-family: monospace;">#${p.id.substring(0,6).toUpperCase()}</td>
                    <td style="padding: 12px 10px; font-weight: bold; color: white;">${escapeHTML(p.cliente || 'Sem Nome')}</td>
                    <td style="padding: 12px 10px; color: var(--text-muted);">${dataStr}</td>
                    <td style="padding: 12px 10px; color: var(--text-green); font-weight: bold;">${escapeHTML(p.totalGeral)}</td>
                </tr>
            `;
        });
    }

    // DESENHANDO OS GRÁFICOS (Chart.js)
    if(chartReceita) chartReceita.destroy();
    if(chartItens) chartItens.destroy();

    const ctxReceita = document.getElementById('graficoFaturamento').getContext('2d');
    chartReceita = new Chart(ctxReceita, {
        type: 'bar', 
        data: {
            labels: labelsDias,
            datasets: datasetsFiltrados
        },
        options: { 
            responsive: true, 
            maintainAspectRatio: false, 
            // NOVA MÁGICA: O balãozinho agora mostra tudo de uma vez!
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: { 
                legend: { display: true, position: 'bottom', labels: { color: '#c9d1d9', font: { size: 11 }, usePointStyle: true, boxWidth: 8 } },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `${context.dataset.label}: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(context.parsed.y)}`;
                        }
                    }
                }
            }, 
            scales: { 
                // NOVA MÁGICA: Tiramos o "stacked: true" para as barras ficarem lado a lado
                y: { stacked: false, beginAtZero: true, grid: { color: '#30363d' }, ticks: { color: '#8b949e' } }, 
                x: { stacked: false, grid: { display: false }, ticks: { color: '#8b949e' } } 
            } 
        }
    });

    const ctxProdutos = document.getElementById('graficoProdutos').getContext('2d');
    chartItens = new Chart(ctxProdutos, {
        type: 'doughnut',
        data: {
            labels: labelsProdutos,
            datasets: [{ data: dadosProdutos, backgroundColor: ['#ff7b72', '#e3b341', '#79c0ff', '#56d364', '#d2a8ff'], borderWidth: 0 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#c9d1d9', font: { size: 11 } } } } }
    });
}

// --- FUNÇÃO DE COMPARTILHAMENTO INTELIGENTE ---
window.compartilharCardapio = async function() {
    // O sistema pega automaticamente o link onde o site está hospedado
    const urlPublica = window.location.origin; 
    
    const dadosCompartilhamento = {
        title: 'Pitstop Burguer - Cardápio Digital',
        text: 'Dá uma olhada nos nossos lanches artesanais e faz o teu pedido por aqui! 🍔🔥',
        url: urlPublica
    };

    // Se estiver no telemóvel ou navegador moderno, abre a partilha nativa
    if (navigator.share) {
        try {
            await navigator.share(dadosCompartilhamento);
        } catch (err) {
            console.log("Partilha cancelada.");
        }
    } else {
        // Fallback para PC: Copia o link e avisa o utilizador
        try {
            await navigator.clipboard.writeText(urlPublica);
            alert("Link do cardápio copiado! 📋 Agora é só colar no WhatsApp dos seus clientes.");
        } catch (err) {
            alert("O link do seu cardápio é: " + urlPublica);
        }
    }
};

// --- FUNÇÃO DE COMPARTILHAR APP DO MOTOBOY ---
window.compartilharAppMotoboy = async function() {
    // Pega na URL base e adiciona /entregador.html
    const urlMotoboy = window.location.origin + '/entregador.html'; 
    
    const dadosCompartilhamento = {
        title: 'Pitstop Entregas - App do Motoboy',
        text: 'Acesse o seu painel de entregas do Pitstop Burguer aqui! Use o seu número de telefone cadastrado como senha. 🛵',
        url: urlMotoboy
    };

    if (navigator.share) {
        try {
            await navigator.share(dadosCompartilhamento);
        } catch (err) {
            console.log("Partilha cancelada.");
        }
    } else {
        try {
            await navigator.clipboard.writeText(urlMotoboy);
            alert("Link do App do Motoboy copiado! 📋 Envie no WhatsApp dos seus entregadores.");
        } catch (err) {
            alert("O link do app é: " + urlMotoboy);
        }
    }
};

window.toggleEntregaGratis = async function() {
    const status = document.getElementById('switch-entrega-gratis').checked;
    try {
        await updateDoc(configRef, { entregaGratisGeral: status });
    } catch(e) { 
        alert("Erro ao aplicar promoção.");
        document.getElementById('switch-entrega-gratis').checked = !status;
    }
}

// ==========================================
// 🛒 MOTOR DO MINI PDV (LANÇAMENTO MANUAL)
// ==========================================
window.carrinhoPDV = [];

window.adicionarItemPDV = function() {
    // Agora lê do nosso campo oculto
    const idFirebase = document.getElementById('pdv-produto-hidden').value;
    const qtd = parseInt(document.getElementById('pdv-qtd').value);
    
    if(!idFirebase || isNaN(qtd) || qtd < 1) return alert("Selecione um produto na lista e digite a quantidade!");
    
    const produtoOriginal = produtosNoBanco.find(p => p.idFirebase === idFirebase);
    if(!produtoOriginal) return;

    carrinhoPDV.push({
        idProdutoOriginal: produtoOriginal.idProduto || Date.now(),
        nome: produtoOriginal.nome,
        preco: produtoOriginal.preco,
        quantidade: qtd,
        listaAdicionais: [] 
    });
    
    // Reseta visualmente o novo campo customizado e a quantidade
    document.getElementById('pdv-qtd').value = 1;
    document.getElementById('pdv-produto-hidden').value = '';
    const spanText = document.getElementById('pdv-select-text');
    if(spanText) {
        spanText.innerText = 'Selecione um lanche...';
        spanText.style.color = "var(--text-muted)";
    }
    document.querySelectorAll('.custom-option').forEach(opt => opt.classList.remove('selected'));
    
    atualizarListaPDV();
}

window.removerItemPDV = function(index) {
    carrinhoPDV.splice(index, 1);
    atualizarListaPDV();
}

window.atualizarListaPDV = function() {
    const lista = document.getElementById('pdv-lista-itens');
    if(!lista) return;
    lista.innerHTML = '';
    
    if(carrinhoPDV.length === 0) {
        lista.innerHTML = '<span style="color: #666; font-size: 13px; font-style: italic; padding: 10px;">Nenhum item na comanda.</span>';
        calcularTotalPDV();
        return;
    }

    carrinhoPDV.forEach((item, index) => {
        const precoFormatado = typeof item.preco === 'number' ? item.preco.toFixed(2).replace('.', ',') : '0,00';
        
        lista.innerHTML += `
            <div class="pdv-item">
                <div class="pdv-item-info">
                    <div class="pdv-item-qtd">${safeNumber(item.quantidade, 1)}x</div>
                    <div class="pdv-item-txt">
                        <strong>${escapeHTML(stripPersonalizado(item.nome))}</strong>
                        <span>R$ ${precoFormatado} cada</span>
                    </div>
                </div>
                <button class="btn-remover-pdv" onclick="removerItemPDV(${index})" title="Remover item">
                    <span class="material-symbols-outlined" style="font-size: 18px;">delete</span>
                </button>
            </div>
        `;
    });
    
    calcularTotalPDV();
}

window.calcularTotalPDV = function() {
    let subtotal = 0;
    carrinhoPDV.forEach(item => subtotal += (item.preco * item.quantidade));
    
    const taxa = parseFloat(document.getElementById('manual-taxa').value) || 0;
    const totalGeral = subtotal + taxa;
    
    document.getElementById('manual-total').value = `R$ ${totalGeral.toFixed(2).replace('.', ',')}`;
}

// O ENVIO FINAL PARA A COZINHA
window.salvarPedidoManual = async function() {
    const nome = document.getElementById('manual-nome').value.trim();
    const campoWhats = document.getElementById('manual-whats');
    const whats = campoWhats ? campoWhats.value.trim() : ''; // Se não existir, deixa vazio sem dar erro!
    const tipo = document.getElementById('manual-tipo').value;
    const pag = document.getElementById('manual-pag').value;
    const end = document.getElementById('manual-end').value.trim();
    const obs = document.getElementById('manual-obs').value.trim();
    const taxa = parseFloat(document.getElementById('manual-taxa').value) || 0;

    if(!nome || carrinhoPDV.length === 0) {
        return alert("⚠️ Preencha o Nome do cliente e adicione pelo menos um lanche na comanda!");
    }
    if(tipo === 'entrega' && !end) {
        return alert("⚠️ Para Delivery, você precisa informar o Endereço!");
    }

    let subtotalCalculado = 0;
    carrinhoPDV.forEach(item => subtotalCalculado += (item.preco * item.quantidade));
    const totalGeral = subtotalCalculado + taxa;
    
    const pacote = {
        cliente: nome + " (Balcão/Fone)",
        whatsapp: whats,
        tipo: tipo,
        endereco: tipo === 'entrega' ? end : 'Não se aplica',
        pagamento: pag === 'pix-ja-pago' ? 'pix-app' : 'pagar-na-entrega',
        observacoes: obs || "Lançado no Caixa",
        subtotal: `R$ ${subtotalCalculado.toFixed(2).replace('.', ',')}`,
        taxaEntrega: `R$ ${taxa.toFixed(2).replace('.', ',')}`,
        totalGeral: `R$ ${totalGeral.toFixed(2).replace('.', ',')}`,
        itens: [...carrinhoPDV], 
        // MUDANÇA: Agora o pedido manual já entra direto na cozinha (Em Preparo)
        status: "Em Preparo", 
        dataCriacao: Date.now(),
        ...(whats ? {
            whatsappPreparoEnviado: false,
            whatsappPreparoStatus: "pendente",
            whatsappPreparoErro: null
        } : {})
    };

    // Agora ele procura o botão dentro do Modal correto!
    const btn = document.querySelector('#modalManual .btn-salvar-lanche');
    if(btn) {
        btn.innerHTML = "⏳ A processar...";
        btn.disabled = true;
    }

    try {
        // Envia para o banco
        await addDoc(collection(db, "pedidos"), pacote);
        
        // A impressão imediata foi removida daqui!
        // O nosso "Radar" vai detectar que chegou um pedido novo na cozinha,
        // vai colocar o Número Sequencial nele e mandar imprimir automaticamente!

        // Esvazia tudo para o próximo pedido
        document.getElementById('manual-nome').value = '';
        if(document.getElementById('manual-whats')) document.getElementById('manual-whats').value = '';
        document.getElementById('manual-end').value = '';
        document.getElementById('manual-obs').value = '';
        document.getElementById('manual-taxa').value = '0.00';
        carrinhoPDV = [];
        atualizarListaPDV();
        
        // Força o redirecionamento para o Painel Principal de Pedidos
        mudarTela('pedidos');
        
    } catch (e) {
        alert("Erro ao lançar pedido: " + e);
    } finally {
        if(btn) {
            btn.innerHTML = "✅ Enviar para a Cozinha";
            btn.disabled = false;
        }
    }
}

// ==========================================
// 🖨️ GERADOR DE COMANDAS PARA IMPRESSORA TÉRMICA
// ==========================================
window.imprimirComanda = function(id) {
    const pedido = dadosCompletosMemoria[id];
    if(!pedido) return alert("Erro ao localizar pedido para impressão.");

    // Formata a data
    let dataFormatada = "";
    if(pedido.dataCriacao) {
        const d = new Date(pedido.dataCriacao);
        dataFormatada = d.toLocaleDateString('pt-BR') + ' às ' + d.toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'});
    }

    // Monta a lista de itens com PREÇOS alinhados à direita e Fonte Monospace
    let itensHtml = '';
    if(pedido.itens) {
        pedido.itens.forEach(item => {
            let pco = (typeof item.preco === 'number') ? item.preco.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'}) : item.preco;
            if(!pco) pco = ""; // Caso seja um item sem preço (como em pedidos antigos)

            itensHtml += `
                <div style="display: flex; justify-content: space-between; align-items: flex-start; font-size: 14px; margin-bottom: 2px;">
                    <span style="flex: 1; padding-right: 10px;"><b>${safeNumber(item.quantidade, 1)}x</b> ${escapeHTML(stripPersonalizado(item.nome))}</span>
                    <span style="font-weight: bold; white-space: nowrap;">${escapeHTML(pco)}</span>
                </div>
            `;
            
            if(item.listaAdicionais && item.listaAdicionais.length > 0) {
                // Coloca um adicional por linha para ficar fácil da cozinha ler
                itensHtml += `<div style="font-size: 12px; padding-left: 20px;">+ ${item.listaAdicionais.map(escapeHTML).join('<br>+ ')}</div>`;
            }
            if(item.obs && item.obs.trim() !== '') {
                itensHtml += `<div style="font-size: 12px; font-weight: bold; padding-left: 20px;">* Obs: ${escapeHTML(item.obs)}</div>`;
            }
            itensHtml += `<div style="margin-bottom: 10px;"></div>`;
        });
    }

    let pagamentoTexto = pedido.pagamento;
    if (pagamentoTexto === 'pagar-na-entrega') pagamentoTexto = 'Dinheiro/Máquina na Entrega';

    // Desenha o Recibo HTML ISOLADO (Layout Premium de Cupom Fiscal)
    const reciboHTML = `
        <html>
        <head>
            <style>
                @page { margin: 0; } 
                /* O padding-left de 15px empurra o texto para a direita, evitando o corte das letras iniciais */
                body { margin: 0; padding: 10px 15px 10px 15px; width: 78mm; color: black; font-weight: bold; font-family: 'Courier New', Courier, monospace; box-sizing: border-box; }
                .linha-tracejada { border-top: 2px dashed black; margin: 10px 0; }
                .flex-row { display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 4px; }
            </style>
        </head>
        <body>
            <h2 style="text-align: center; margin: 0 0 5px 0; font-size: 18px; text-transform: uppercase;">PITSTOP BURGUER</h2>
            <div style="text-align: center; font-size: 20px; font-weight: bold; margin-bottom: 2px; padding: 4px; border: 2px solid black;">PEDIDO #${pedido.numeroDiario.toString().padStart(3, '0')}</div>
            <div style="text-align: center; font-size: 12px; margin-bottom: 10px; margin-top: 5px;">${dataFormatada}</div>
            
            <div class="linha-tracejada"></div>
            <div style="font-size: 14px; font-weight: bold; text-align: center; margin-bottom: 10px;">ITENS DO PEDIDO</div>
            
            <div style="margin-bottom: 10px;">
                ${itensHtml}
            </div>
            
            <div class="linha-tracejada"></div>
            
            <div style="font-size: 14px; margin-bottom: 4px;"><b>Cliente:</b> ${escapeHTML(pedido.cliente)}</div>
            <div style="font-size: 14px; margin-bottom: 4px;"><b>Tipo:</b> ${escapeHTML(String(pedido.tipo ?? '').toUpperCase())}</div>
            ${pedido.tipo === 'entrega' ? `<div style="font-size: 14px; margin-bottom: 4px;"><b>Endereço:</b> ${escapeHTML(pedido.endereco)}</div>` : ''}
            <div style="font-size: 14px; margin-bottom: 10px;"><b>Pgto:</b> ${escapeHTML(pagamentoTexto)}</div>
            
            <div class="linha-tracejada"></div>
            
            ${pedido.observacoes && pedido.observacoes !== 'Nenhuma' ? `<div style="font-size: 14px; margin-bottom: 10px; border: 1px solid black; padding: 6px;"><b>OBS GERAIS:</b><br>${escapeHTML(pedido.observacoes)}</div><div class="linha-tracejada"></div>` : ''}
            
            ${pedido.subtotal ? `<div class="flex-row"><span>Subtotal:</span><span>${escapeHTML(pedido.subtotal)}</span></div>` : ''}
            ${pedido.tipo === 'entrega' && pedido.taxaEntrega ? `<div class="flex-row"><span>Taxa de Entrega:</span><span>${escapeHTML(pedido.taxaEntrega)}</span></div>` : ''}
            
            <div class="flex-row" style="margin-top: 10px; font-size: 18px; font-weight: bold;">
                <span>TOTAL:</span>
                <span>${escapeHTML(pedido.totalGeral)}</span>
            </div>
            
            <div style="text-align: center; margin-top: 25px; font-size: 12px; font-weight: bold;">Obrigado pela preferência!</div>
            
            <br><br><br><br>
        </body>
        </html>
    `;

    // Cria uma impressora invisível ÚNICA para não misturar pedidos simultâneos
    const idIframeUnico = 'iframe-impressora-' + id + '-' + Date.now();
    let iframe = document.createElement('iframe');
    iframe.id = idIframeUnico;
    iframe.style.position = 'absolute';
    iframe.style.width = '0px';
    iframe.style.height = '0px';
    iframe.style.border = 'none';
    document.body.appendChild(iframe);

    // Escreve o recibo dentro desse arquivo invisível
    const docIframe = iframe.contentWindow.document;
    docIframe.open();
    docIframe.write(reciboHTML);
    docIframe.close();

    // Aguarda apenas 100 milissegundos para o HTML ser renderizado invisivelmente e imprime rápido!
    setTimeout(() => {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
        
        // Remove a janela fantasma depois de 5 segundos para não pesar o computador
        setTimeout(() => {
            const ifrLimpar = document.getElementById(idIframeUnico);
            if (ifrLimpar) ifrLimpar.remove();
        }, 5000);
    }, 100);
}

// ==========================================
// GESTÃO DE BAIRROS E TAXAS DE ENTREGA
// ==========================================

// 1. Escuta os bairros em tempo real
onSnapshot(collection(db, "bairros"), (snapshot) => {
    const grid = document.getElementById('grid-bairros');
    if(!grid) return;
    grid.innerHTML = '';

    snapshot.forEach((docSnap) => {
        const b = docSnap.data();
        const id = docSnap.id;
        const taxaTexto = b.taxa === 0 ? "GRÁTIS" : `R$ ${b.taxa.toFixed(2).replace('.', ',')}`;
        const corTaxa = b.taxa === 0 ? "var(--text-green)" : "white";

        grid.innerHTML += `
            <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 10px; padding: 10px 15px; display: flex; align-items: center; gap: 10px; transition: 0.2s;" onmouseover="this.style.borderColor='var(--text-orange)'" onmouseout="this.style.borderColor='var(--border-color)'">
                <div style="flex: 1; min-width: 0;">
                    <strong style="color: white; font-size: 13px; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHTML(b.nome)}</strong>
                    <span style="font-size: 11px; color: ${corTaxa}; font-weight: bold;">Taxa: ${taxaTexto}</span>
                </div>
                <button onclick="excluirBairro(${jsArg(id)})" style="background: none; border: none; color: var(--text-muted); cursor: pointer; display: flex; align-items: center; transition: 0.2s;" onmouseover="this.style.color='var(--text-red)'" onmouseout="this.style.color='var(--text-muted)'">
                    <span class="material-symbols-outlined" style="font-size: 18px;">close</span>
                </button>
            </div>
        `;
    });
});

window.salvarBairro = async function() {
    const nome = document.getElementById('bairro-nome').value.trim();
    const taxa = parseFloat(document.getElementById('bairro-taxa').value);

    if(!nome || isNaN(taxa)) return alert("Preencha o nome e a taxa corretamente!");

    try {
        await addDoc(collection(db, "bairros"), {
            nome: nome,
            taxa: taxa,
            criadoEm: Date.now()
        });
        document.getElementById('bairro-nome').value = '';
        document.getElementById('bairro-taxa').value = '';
        alert("Bairro cadastrado com sucesso!");
    } catch (e) { alert("Erro ao salvar: " + e); }
}

window.excluirBairro = async function(id) {
    if(confirm("Deseja remover este bairro da lista?")) {
        await deleteDoc(doc(db, "bairros", id));
    }
}

// CONTROLO DO MODAL DE PEDIDO MANUAL E TRAVA DE IMPRESSÃO
window.abrirModalManual = function() {
    window.caixaOcupado = true; // Trava a impressora para não congelar!
    document.getElementById('modalManual').style.display = 'flex';
}

window.fecharModalManual = function() {
    window.caixaOcupado = false; // Destrava a impressora!
    document.getElementById('modalManual').style.display = 'none';
    window.liberarFilaDeImpressao(); // Cospe as comandas que ficaram retidas
}

// Pequeno ajuste: fechar o modal automaticamente após salvar
const originalSalvarPedidoManual = window.salvarPedidoManual;
window.salvarPedidoManual = async function() {
    await originalSalvarPedidoManual();
    window.fecharModalManual();
}

// ==========================================
// 🔍 LÓGICA DO SELECT CUSTOMIZADO PREMIUM
// ==========================================
window.toggleCustomSelect = function() {
    const panel = document.getElementById('pdv-select-panel');
    panel.classList.toggle('open');
    if(panel.classList.contains('open')) {
        document.getElementById('pdv-search-input').focus();
    }
}

window.selecionarProdutoPDV = function(idFirebase, nomeLanche) {
    document.getElementById('pdv-produto-hidden').value = idFirebase;
    document.getElementById('pdv-select-text').innerText = nomeLanche;
    document.getElementById('pdv-select-text').style.color = "var(--text-main)";
    document.getElementById('pdv-select-panel').classList.remove('open');
    
    // Remove a classe 'selected' de todos e adiciona no clicado
    document.querySelectorAll('.custom-option').forEach(opt => opt.classList.remove('selected'));
    const opcaoClicada = document.querySelector(`.custom-option[data-id="${idFirebase}"]`);
    if(opcaoClicada) opcaoClicada.classList.add('selected');
}

window.filtrarCustomSelect = function() {
    const termo = document.getElementById('pdv-search-input').value.toLowerCase().trim();
    const opcoes = document.querySelectorAll('.custom-option');
    
    opcoes.forEach(opt => {
        const nome = opt.getAttribute('data-nome');
        if(nome.includes(termo)) {
            opt.style.display = 'flex';
        } else {
            opt.style.display = 'none';
        }
    });
}

// Fecha menus suspensos se clicar fora deles para não atrapalhar a tela
document.addEventListener('click', function(event) {
    // Fecha o select customizado do PDV
    const selectWrapper = document.getElementById('pdv-custom-select');
    if (selectWrapper && !selectWrapper.contains(event.target)) {
        const panel = document.getElementById('pdv-select-panel');
        if(panel) panel.classList.remove('open');
    }

    // Fecha o menu de temas da sidebar
    const menuTemas = document.getElementById('menu-temas');
    if (menuTemas && menuTemas.style.display === 'block' && !menuTemas.contains(event.target)) {
        menuTemas.style.display = 'none';
    }
});

// ==========================================
// 🌗 GESTÃO DE TEMAS (LIGHT/DARK/AUTO)
// ==========================================
window.alternarTemaMenu = (event) => {
    if(event) event.stopPropagation();
    const menu = document.getElementById('menu-temas');
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
};

window.setTema = (tema) => {
    localStorage.setItem('tema_preferido', tema);
    aplicarTema(tema);
    document.getElementById('menu-temas').style.display = 'none';
};

function aplicarTema(tema) {
    const html = document.documentElement;
    const icone = document.getElementById('icone-tema');
    if(!icone) return;

    if (tema === 'auto') {
        const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        html.setAttribute('data-theme', isDark ? 'dark' : 'light');
        icone.innerText = 'settings_brightness';
    } else {
        html.setAttribute('data-theme', tema);
        icone.innerText = tema === 'light' ? 'light_mode' : 'dark_mode';
    }
}

// Inicializa o tema ao carregar a página
const temaSalvo = localStorage.getItem('tema_preferido') || 'dark';
aplicarTema(temaSalvo);

// Ouve mudanças no sistema em tempo real se estiver em modo 'auto'
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (localStorage.getItem('tema_preferido') === 'auto') aplicarTema('auto');
});

// ==========================================
// 📦 MÓDULO DE ESTOQUE RÁPIDO (DINÂMICO)
// ==========================================
window.abrirModalEstoque = function() {
    document.getElementById('modalEstoque').style.display = 'flex';
    renderizarEstoqueModal(); // Desenha a lista de produtos na hora!
}

window.fecharModalEstoque = function() {
    document.getElementById('modalEstoque').style.display = 'none';
}

window.filtrarEstoque = function() {
    const categoria = document.getElementById('filtro-categoria-estoque').value;
    renderizarEstoqueModal(categoria);
}

window.renderizarEstoqueModal = function(categoriaFiltro = 'todas') {
    const grid = document.getElementById('grid-estoque');
    if (!grid) return;
    grid.innerHTML = '';

    produtosNoBanco.forEach(p => {
        if (categoriaFiltro !== 'todas' && p.categoria !== categoriaFiltro) return;

        const fotoUrl = safeHttpUrl(p.imagem);
        const valorEstoque = (p.estoque !== undefined && p.estoque !== null) ? p.estoque : '';

        // --- MÁGICA: SEPARA LANCHES DE BEBIDAS ---
        const isLanche = ['Hamburguers', 'Sanduíches', 'Porções'].includes(p.categoria);
        let controleHTML = '';

        if (isLanche) {
            // Lógica do botão On/Off (Estoque infinito vs Zero)
            const isAtivo = !(p.estoque !== undefined && p.estoque !== null && p.estoque <= 0);
            const checkedAttr = isAtivo ? 'checked' : '';
            
            controleHTML = `
                <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 5px;">
                    <label style="font-size: 10px; color: var(--text-muted); font-weight: bold;">STATUS NO SITE</label>
                    <label class="ios-switch" style="transform: scale(0.8); transform-origin: right; margin-top: 2px;">
                        <input type="checkbox" ${checkedAttr} onchange="toggleEstoqueLanche(${jsArg(p.idFirebase)}, this)">
                        <span class="ios-slider"></span>
                    </label>
                </div>
            `;
        } else {
            // Lógica da caixinha de quantidade (Bebidas, Sobremesas)
            controleHTML = `
                <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 5px;">
                    <label style="font-size: 10px; color: var(--text-muted); font-weight: bold;">QTD DISPONÍVEL</label>
                    <input type="number" min="0" value="${escapeAttr(valorEstoque)}" placeholder="Infinito" onchange="salvarEstoqueItem(${jsArg(p.idFirebase)}, this)" style="width: 80px; text-align: center; background: rgba(0,0,0,0.3); border: 1px solid var(--border-color); color: var(--text-orange); padding: 8px; border-radius: 6px; font-weight: bold; outline: none; transition: 0.3s;">
                </div>
            `;
        }

        grid.innerHTML += `
            <div style="background: var(--bg-main); border: 1px solid var(--border-color); border-radius: 12px; padding: 12px; display: flex; align-items: center; gap: 12px; transition: 0.2s;">
                <img src="${escapeAttr(fotoUrl)}" style="width: 50px; height: 50px; border-radius: 8px; object-fit: cover; border: 1px solid rgba(255,255,255,0.05);">
                <div style="flex: 1;">
                    <strong style="color: white; font-size: 14px; display: block; margin-bottom: 4px;">${escapeHTML(p.nome)}</strong>
                    <span style="font-size: 11px; color: var(--text-muted); background: rgba(255,255,255,0.05); padding: 2px 6px; border-radius: 4px;">${escapeHTML(p.categoria)}</span>
                </div>
                ${controleHTML}
            </div>
        `;
    });

    if(grid.innerHTML === '') {
        grid.innerHTML = '<p style="color: var(--text-muted); padding: 20px; width: 100%; grid-column: 1 / -1; text-align: center;">Nenhum produto encontrado nesta categoria.</p>';
    }
}

// NOVA FUNÇÃO EXCLUSIVA PARA O BOTÃO DOS LANCHES
window.toggleEstoqueLanche = async function(idFirebase, checkboxElement) {
    // Se ligou -> Infinito (null). Se desligou -> Esgotado (0)
    let valorParaSalvar = checkboxElement.checked ? null : 0;

    try {
        await updateDoc(doc(db, "produtos", idFirebase), {
            estoque: valorParaSalvar
        });
        
        // Um pequeno feedback visual piscando a bordinha da caixa
        const card = checkboxElement.closest('div[style*="background: var(--bg-main)"]');
        if(card) {
            card.style.borderColor = checkboxElement.checked ? "var(--text-green)" : "var(--text-red)";
            setTimeout(() => { card.style.borderColor = "var(--border-color)"; }, 1000);
        }

    } catch (error) {
        console.error("Erro ao alterar status do lanche:", error);
        alert("Erro ao alterar a disponibilidade. Verifique a internet.");
        checkboxElement.checked = !checkboxElement.checked; // Reverte o botão se der erro
    }
}

window.salvarEstoqueItem = async function(idFirebase, inputElement) {
    let novoEstoque = inputElement.value.trim();
    
    // Se o cliente apagar o número da caixinha, volta a ser "Estoque Infinito" (salvamos null)
    let valorParaSalvar = novoEstoque === '' ? null : parseInt(novoEstoque);

    try {
        // Atualiza direto no Firebase em tempo real
        await updateDoc(doc(db, "produtos", idFirebase), {
            estoque: valorParaSalvar
        });
        
        // Efeito visual de Sucesso (Pisca verde rapidinho!)
        inputElement.style.borderColor = "var(--text-green)";
        inputElement.style.color = "var(--text-green)";
        setTimeout(() => {
            inputElement.style.borderColor = "var(--border-color)";
            inputElement.style.color = "var(--text-orange)";
        }, 1200);

    } catch (error) {
        console.error("Erro ao salvar estoque:", error);
        alert("Erro ao salvar o número. Verifique a internet.");
    }
}

// ==========================================
// 🍳 MÓDULO DE ESTOQUE DE COZINHA (INSUMOS)
// ==========================================
window.insumosNaMemoria = [];

// 1. Escuta o Firebase para atualizar a lista de insumos em tempo real
onSnapshot(collection(db, "insumos"), (snapshot) => {
    window.insumosNaMemoria = [];
    const grid = document.getElementById('grid-insumos');
    if(!grid) return;
    grid.innerHTML = '';

    snapshot.forEach((docSnap) => {
        const insumo = docSnap.data();
        const id = docSnap.id;
        insumosNaMemoria.push({ id, ...insumo });

        grid.innerHTML += `
            <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px; padding: 10px 15px; display: flex; align-items: center; gap: 12px; transition: 0.2s;">
                <div style="flex: 1; min-width: 0;">
                    <strong style="color: white; font-size: 13px; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-transform: capitalize;">${escapeHTML(insumo.nome)}</strong>
                    <span style="font-size: 11px; color: var(--text-muted);">Estoque: <b style="color: var(--text-orange);">${escapeHTML(insumo.quantidade)}</b></span>
                </div>

                <div style="display: flex; align-items: center; gap: 5px; background: rgba(0,0,0,0.2); padding: 4px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.03);">
                    <input type="number" id="entrada-${escapeAttr(id)}" placeholder="+ Qtd" style="width: 50px; background: transparent; border: none; color: var(--text-green); font-size: 12px; font-weight: bold; outline: none; text-align: center;">
                    <button onclick="entradaInsumo(${jsArg(id)})" style="background: var(--text-green); color: black; border: none; border-radius: 4px; width: 26px; height: 24px; cursor: pointer; display: flex; align-items: center; justify-content: center;">
                        <span class="material-symbols-outlined" style="font-size: 16px; font-weight: bold;">add</span>
                    </button>
                </div>

                <button onclick="excluirInsumo(${jsArg(id)})" style="background: none; border: none; color: var(--text-muted); cursor: pointer; transition: 0.2s; display: flex; align-items: center;" onmouseover="this.style.color='var(--text-red)'" onmouseout="this.style.color='var(--text-muted)'">
                    <span class="material-symbols-outlined" style="font-size: 18px;">delete</span>
                </button>
            </div>
        `;
    });
    
    // Mantém a caixinha do "Novo Lanche" atualizada com a lista de insumos
    if (typeof window.atualizarSelectInsumosNoLanche === 'function') window.atualizarSelectInsumosNoLanche();
});

window.abrirModalCozinha = () => document.getElementById('modalCozinha').style.display = 'flex';
window.fecharModalCozinha = () => document.getElementById('modalCozinha').style.display = 'none';

window.cadastrarNovoInsumo = async function() {
    const nome = document.getElementById('novo-insumo-nome').value.trim();
    const qtd = parseInt(document.getElementById('novo-insumo-qtd').value) || 0;

    if(!nome) return alert("Digite o nome do insumo!");

    try {
        await addDoc(collection(db, "insumos"), { nome, quantidade: qtd });
        document.getElementById('novo-insumo-nome').value = '';
        document.getElementById('novo-insumo-qtd').value = '';
    } catch (e) { alert("Erro ao salvar insumo."); }
}

window.atualizarQtdInsumo = async function(id, novaQtd) {
    try {
        await updateDoc(doc(db, "insumos", id), { quantidade: parseInt(novaQtd) });
    } catch (e) { alert("Erro ao atualizar."); }
}

window.entradaInsumo = async function(id) {
    const input = document.getElementById(`entrada-${id}`);
    const valorAdicional = parseInt(input.value);

    if (isNaN(valorAdicional) || valorAdicional <= 0) {
        return alert("Digite uma quantidade válida para adicionar.");
    }

    try {
        // MÁGICA: O Firebase pega o valor que já existe lá e soma com o novo!
        await updateDoc(doc(db, "insumos", id), {
            quantidade: increment(valorAdicional)
        });
        
        input.value = ''; // Limpa o campo após somar
    } catch (e) {
        alert("Erro ao dar entrada no estoque.");
    }
}

window.excluirInsumo = async function(id) {
    if(confirm("Remover este insumo do controle?")) {
        await deleteDoc(doc(db, "insumos", id));
    }
}

// ==========================================
// ➕ MOTOR DE ADICIONAIS GLOBAIS (ERP)
// ==========================================
window.abrirModalAdicionais = () => {
    document.getElementById('modalAdicionais').style.display = 'flex';
    carregarAdicionaisGlobais();
};
window.fecharModalAdicionais = () => document.getElementById('modalAdicionais').style.display = 'none';

window.cadastrarAdicionalGlobal = async function() {
    const nome = document.getElementById('novo-add-nome').value.trim();
    const preco = parseFloat(document.getElementById('novo-add-preco').value.replace(',', '.'));

    if(!nome || isNaN(preco)) return alert("Preencha nome e preço corretamente!");

    try {
        await addDoc(collection(db, "adicionais_global"), { nome, preco });
        document.getElementById('novo-add-nome').value = '';
        document.getElementById('novo-add-preco').value = '';
    } catch (e) { alert("Erro ao salvar adicional."); }
};

function carregarAdicionaisGlobais() {
    onSnapshot(collection(db, "adicionais_global"), (snapshot) => {
        const grid = document.getElementById('grid-adicionais-global');
        if(!grid) return;
        grid.innerHTML = '';

        snapshot.forEach((docSnap) => {
            const add = docSnap.data();
            const id = docSnap.id;
            grid.innerHTML += `
                <div style="background: var(--bg-card); border: 1px solid var(--border-color); padding: 12px 15px; border-radius: 10px; display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <strong style="color: white; font-size: 15px;">${escapeHTML(add.nome)}</strong>
                        <span style="color: var(--text-green); font-size: 13px; margin-left: 10px; font-weight: bold;">+ R$ ${safeNumber(add.preco).toFixed(2).replace('.',',')}</span>
                    </div>
                    <button onclick="excluirAdicionalGlobal(${jsArg(id)})" style="background:rgba(255,255,255,0.05); border:none; color:var(--text-red); width:32px; height:32px; border-radius:6px; cursor:pointer; font-size:18px;">&times;</button>
                </div>
            `;
        });
    });
}

window.excluirAdicionalGlobal = async (id) => {
    if(confirm("Deseja remover este adicional de todos os lanches?")) {
        await deleteDoc(doc(db, "adicionais_global", id));
    }
};
