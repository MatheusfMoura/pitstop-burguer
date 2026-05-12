import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, query, orderBy, onSnapshot, doc, updateDoc, addDoc, deleteDoc, setDoc, getDocs, where, increment } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyCUjBWv40J0Mp6KsHzWxOwz6hNyWDHOYT8",
    authDomain: "pitstop-burguer.firebaseapp.com",
    projectId: "pitstop-burguer",
    storageBucket: "pitstop-burguer.firebasestorage.app",
    messagingSenderId: "749099939746",
    appId: "1:749099939746:web:1716fc96eb83bb1f7724fb"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app); 
const auth = getAuth(app);

// ==========================================
// SISTEMA DE LOGIN CRIPTOGRAFADO (FIREBASE)
// ==========================================

// O Firebase fica vigiando: Se o token do Google for válido, ele libera. Se não, trava a tela!
onAuthStateChanged(auth, (user) => {
    const telaLogin = document.getElementById('tela-login-gestor');
    if(telaLogin) {
        if (user) {
            telaLogin.style.display = 'none'; // Esconde a tela de login
        } else {
            telaLogin.style.display = 'flex'; // Força a tela de login a aparecer
        }
    }
});

window.entrarGestor = async function() {
    // Pega o e-mail que deixamos escondido no HTML
    const email = document.getElementById('email-gestor').value.trim();
    const senha = document.getElementById('senha-gestor').value;
    const btn = document.querySelector('#tela-login-gestor button');
    
    if(!senha) return alert("Preencha a sua senha!");
    
    btn.innerText = "⏳ Desbloqueando...";
    btn.disabled = true;

    try {
        await signInWithEmailAndPassword(auth, email, senha);
       
    } catch(error) {
        alert("❌ Acesso negado! Senha incorreta.");
        document.getElementById('senha-gestor').value = ''; // Limpa a senha errada
    } finally {
        btn.innerText = "Desbloquear";
        btn.disabled = false;
    }
}

window.sairGestor = function() {
    if(confirm("Deseja trancar o caixa e desconectar do servidor?")) {
        signOut(auth).then(() => {
            window.location.reload();
        });
    }
}

// NAVEGAÇÃO DE TELAS
window.mudarTela = function(nomeDaTela) {
    document.querySelectorAll('.tela').forEach(t => t.classList.remove('ativa'));
    document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('ativa'));
    
    document.getElementById('tela-' + nomeDaTela).classList.add('ativa');
    document.getElementById('btn-menu-' + nomeDaTela).classList.add('ativa');

    // Se clicar em Relatórios, puxa os dados do Firebase na hora!
    if(nomeDaTela === 'relatorios') {
        window.carregarDashboard();
    }
}

// LÓGICA DO NOVO CARDÁPIO (TELA COMPLETA)
let tempIngredientes = [];
let tempAdicionais = [];
let tempOpcoes = [];
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

        const fotoUrl = (prod.imagem && prod.imagem.startsWith('http')) ? prod.imagem : 'https://cdn-icons-png.flaticon.com/512/3075/3075977.png';

        let descText = (prod.ingredientes && prod.ingredientes.length > 0) ? prod.ingredientes.join(', ') : 'Ingredientes não informados.';
        if(descText.length > 65) descText = descText.substring(0, 65) + '...';

        grid.innerHTML += `
            <div class="card-produto-real" style="cursor: pointer; transition: 0.2s;" onclick="editarProdutoReal('${docId}')" onmouseover="this.style.borderColor='var(--text-blue)'" onmouseout="this.style.borderColor='var(--border-color)'">
                <img src="${fotoUrl}" class="img-produto" alt="Foto Lanche">
                <div class="conteudo-produto">
                    <div>
                        <div class="titulo-produto">${prod.nome}</div>
                        <span style="color: var(--text-green); font-weight: bold; margin-bottom: 8px; display: block;">R$ ${prod.preco.toFixed(2).replace('.',',')}</span>
                        <div class="desc-produto">${descText}</div>
                    </div>
                    <button onclick="excluirProdutoReal(event, '${docId}')" style="background: var(--soft-red); color: var(--text-red); border: none; padding: 10px; border-radius: 4px; cursor: pointer; font-weight: bold; width: 100%; z-index: 10;">🗑️ Remover do Site</button>
                </div>
            </div>
        `;
    });
    document.getElementById('contador-lanches').innerText = `${contador} itens`;

    // --- ALIMENTA O SELECT DO MINI PDV AUTOMATICAMENTE ---
    const selectPDV = document.getElementById('pdv-produto');
    if(selectPDV) {
        selectPDV.innerHTML = '<option value="">Selecione um produto...</option>';
        produtosNoBanco.forEach(p => {
            selectPDV.innerHTML += `<option value="${p.idFirebase}">${p.nome} - R$ ${p.preco.toFixed(2).replace('.',',')}</option>`;
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
            const fotoUrl = (p.imagem && p.imagem.startsWith('http')) ? p.imagem : 'https://cdn-icons-png.flaticon.com/512/3075/3075977.png';
            
            // Salvamos a categoria invisível no cartão para o filtro ler
            const catFiltro = p.categoria || 'Outros';
            
            gridEstoque.innerHTML += `
                <div class="cartao-estoque-item" data-categoria="${catFiltro}" style="background: var(--bg-card); border: 1px solid var(--border-color); padding: 15px; border-radius: 12px; display: flex; flex-direction: column; justify-content: space-between; gap: 15px; transition: 0.2s;" onmouseover="this.style.borderColor='var(--text-blue)'" onmouseout="this.style.borderColor='var(--border-color)'">
                    <div style="display: flex; gap: 15px; align-items: center;">
                        <img src="${fotoUrl}" style="width: 65px; height: 65px; object-fit: cover; border-radius: 8px; flex-shrink: 0; border: 1px solid #444; background: #222;">
                        <div style="flex: 1; min-width: 0;">
                            <strong style="color: white; font-size: 15px; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${p.nome}">${p.nome}</strong> 
                            <span style="font-size: 12px; color: var(--text-muted); display: block; margin-bottom: 5px;">${p.categoria}</span>
                            ${badgeEsgotado}
                        </div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 10px; width: 100%;">
                        <input type="number" id="estoque-${p.idFirebase}" class="input-padrao" style="width: 100%; flex: 1; text-align: center; padding: 10px; font-weight: bold;" placeholder="Infinito" value="${estoqueAtual}">
                        <button onclick="salvarEstoqueProduto('${p.idFirebase}')" style="background: var(--text-blue); color: black; border: none; padding: 10px 15px; border-radius: 6px; font-weight: bold; cursor: pointer; transition: 0.2s;">Atualizar</button>
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

window.editarProdutoReal = function(docId) {
    const prod = produtosNoBanco.find(p => p.idFirebase === docId);
    if(!prod) return;

    idLancheEmEdicao = docId; 

    document.getElementById('form-nome').value = prod.nome || '';
    document.getElementById('form-preco').value = prod.preco || '';
    document.getElementById('form-img').value = prod.imagem || '';
    document.getElementById('form-categoria').value = prod.categoria || 'Hamburguers';

    tempIngredientes = prod.ingredientes ? [...prod.ingredientes] : [];
    tempAdicionais = prod.adicionais ? [...prod.adicionais] : [];
    tempOpcoes = prod.opcoes ? [...prod.opcoes] : [];
    renderizarListasTemp();

    document.getElementById('titulo-form-lanche').innerText = "✏️ Editando: " + prod.nome;
    document.getElementById('btn-salvar-lanche').style.display = 'none';
    document.getElementById('btn-atualizar-lanche').style.display = 'block';
    document.getElementById('btn-cancelar-edicao').style.display = 'block';
}

window.cancelarEdicao = function() {
    idLancheEmEdicao = null;
    
    document.getElementById('form-categoria').value = 'Hamburguers';
    document.getElementById('form-nome').value = '';
    document.getElementById('form-preco').value = '';
    document.getElementById('form-img').value = '';
    tempIngredientes = [];
    tempAdicionais = [];
    tempOpcoes = [];
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
    const categoriaEscolhida = document.getElementById('form-categoria').value; // PEGA A CATEGORIA

    if(!nome || isNaN(preco)) {
        return alert("⚠️ Nome e Preço são obrigatórios!");
    }

    const dadosAtualizados = {
        nome: nome,
        preco: preco,
        imagem: imgFinal, 
        categoria: categoriaEscolhida, // ATUALIZA A CATEGORIA
        ingredientes: [...tempIngredientes],
        adicionais: [...tempAdicionais],
        opcoes: [...tempOpcoes] 
    };

    try {
        await updateDoc(doc(db, "produtos", idLancheEmEdicao), dadosAtualizados);
        alert("✏️ Lanche atualizado com sucesso!");
        cancelarEdicao(); 
    } catch(erro) {
        alert("Erro ao atualizar: " + erro);
    }
}

window.salvarNovoLanche = async function() {
    const nome = document.getElementById('form-nome').value;
    const preco = parseFloat(document.getElementById('form-preco').value.replace(',', '.'));
    const imgFinal = document.getElementById('form-img').value.trim().replace(/['"]/g, '');
    const categoriaEscolhida = document.getElementById('form-categoria').value; // PEGA A CATEGORIA

    if(!nome || isNaN(preco)) {
        return alert("⚠️ Nome e Preço são obrigatórios!");
    }

    let maxId = 0;
    produtosNoBanco.forEach(p => { if(p.idProduto > maxId) maxId = p.idProduto; });

    const novoProduto = {
        idProduto: maxId + 1,
        nome: nome,
        preco: preco,
        imagem: imgFinal,
        categoria: categoriaEscolhida, // SALVA A CATEGORIA
        ingredientes: [...tempIngredientes],
        adicionais: [...tempAdicionais],
        opcoes: [...tempOpcoes] 
    };

    try {
        await addDoc(collection(db, "produtos"), novoProduto);
        cancelarEdicao(); 
        alert("🍔 Lanche publicado no site com sucesso!");
    } catch(erro) {
        alert("Erro: " + erro);
    }
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

window.removerItemTemp = function(tipo, index) {
    if(tipo === 'ing') tempIngredientes.splice(index, 1);
    if(tipo === 'add') tempAdicionais.splice(index, 1);
    if(tipo === 'opt') tempOpcoes.splice(index, 1);
    renderizarListasTemp();
}

function renderizarListasTemp() {
    const boxIng = document.getElementById('box-ingredientes-temp');
    if(boxIng) {
        boxIng.innerHTML = '';
        tempIngredientes.forEach((ing, i) => {
            boxIng.innerHTML += `<span class="tag-item">${ing} <button class="btn-remover-tag" onclick="removerItemTemp('ing', ${i})">×</button></span>`;
        });
    }

    const boxAdd = document.getElementById('box-adicionais-temp');
    if(boxAdd) { // <-- A BLINDAGEM ESTÁ AQUI
        boxAdd.innerHTML = '';
        tempAdicionais.forEach((add, i) => {
            boxAdd.innerHTML += `<span class="tag-item">${add.nome} (+R$${add.preco.toFixed(2)}) <button class="btn-remover-tag" onclick="removerItemTemp('add', ${i})">×</button></span>`;
        });
    }

    const boxOpt = document.getElementById('box-opcoes-temp');
    if(boxOpt) {
        boxOpt.innerHTML = '';
        tempOpcoes.forEach((opt, i) => {
            boxOpt.innerHTML += `<span class="tag-item" style="border-color: var(--text-orange);">${opt.nome} (R$${opt.preco.toFixed(2)}) <button class="btn-remover-tag" onclick="removerItemTemp('opt', ${i})">×</button></span>`;
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

    document.getElementById('drawer-id').innerText = `#${id.substring(0,6).toUpperCase()} • ⏰ ${dataPedidoFormatada}`;

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
            <div style="font-size: 22px; font-weight: bold; color: white;">👤 ${pedido.cliente || "Sem Nome"}</div>
            ${whatsAppLimpo ? `<a href="${linkWhats}" target="_blank" style="background: var(--soft-green); color: var(--text-green); border: 1px solid rgba(46, 160, 67, 0.4); padding: 8px 14px; border-radius: 8px; text-decoration: none; font-size: 13px; font-weight: bold; display: flex; align-items: center; gap: 6px; transition: 0.2s;" onmouseover="this.style.background='rgba(46, 160, 67, 0.3)'" onmouseout="this.style.background='var(--soft-green)'">💬 WhatsApp</a>` : ''}
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
            <a href="${linkMapa}" target="_blank" style="text-decoration: none; display: block;">
                <div style="background: rgba(46, 160, 67, 0.1); border-left: 4px solid var(--text-green); padding: 12px; border-radius: 4px; color: white; line-height: 1.5; font-size: 15px; cursor: pointer; transition: 0.2s;" onmouseover="this.style.background='rgba(46, 160, 67, 0.2)'" onmouseout="this.style.background='rgba(46, 160, 67, 0.1)'">
                    📍 ${pedido.endereco} <br>
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
            let adds = (item.listaAdicionais && item.listaAdicionais.length > 0) ? `<div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">&plus; ${item.listaAdicionais.join(', ')}</div>` : '';
            let obs = (item.obs && item.obs.trim() !== '') ? `<div style="font-size: 13px; color: var(--text-red); margin-top: 4px; font-weight: bold;">⚠️ Obs: ${item.obs}</div>` : '';
            let pco = (typeof item.preco === 'number') ? item.preco.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'}) : item.preco;
            
            itensHTML += `
                <div style="background: var(--bg-main); border: 1px solid var(--border-color); padding: 12px; border-radius: 8px; margin-bottom: 10px;">
                    <div style="display: flex; justify-content: space-between; font-weight: bold; font-size: 15px; color: white;">
                        <span><span style="color: var(--text-orange); margin-right: 5px;">${item.quantidade}x</span> ${item.nome.replace(' (Personalizado)', '')}</span> 
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
                <span>${pedido.taxaEntrega}</span>
            </div>`;
    }
    document.getElementById('drawer-itens').innerHTML = itensHTML || '<div class="info-text">Sem itens</div>';

    // 7. OBSERVAÇÕES GERAIS E TOTAL
    const obsGeralHtml = (pedido.observacoes && pedido.observacoes !== "Nenhuma") 
        ? `<div style="background: var(--soft-orange); color: var(--text-orange); padding: 12px; border-radius: 8px; font-weight: bold; border: 1px solid rgba(210, 153, 34, 0.4);">🚨 ${pedido.observacoes}</div>`
        : `<div style="color: var(--text-muted); font-style: italic;">Sem observações.</div>`;
    document.getElementById('drawer-obs').innerHTML = obsGeralHtml;
    
    document.getElementById('drawer-total').innerText = pedido.totalGeral;

    // 8. BOTÕES DE AÇÃO (Com a lógica do Motoboy aplicada)
    // O botão de imprimir fica sempre fixo do lado esquerdo
    let actHTML = `<button class="btn-action" style="background:#444; color:#fff; flex: 0.4;" onclick="imprimirComanda('${id}')">🖨️ Imprimir</button>`;
    
    if(pedido.status === "Pendente") actHTML += `<button class="btn-action" style="background:var(--text-orange); color:#000;" onclick="mudarStatusFechando('${id}', 'Em Preparo')">👨‍🍳 Iniciar Preparo</button>`;
    else if(pedido.status === "Em Preparo") actHTML = `<button class="btn-action" style="background:var(--text-blue); color:#000;" onclick="mudarStatusFechando('${id}', 'Pronto')">✅ Marcar Pronto</button>`;
    
    // AQUI ENTRA A LÓGICA DE ESCOLHER O MOTOBOY (O Passo 3 Perdido)
    else if(pedido.status === "Pronto" && mostraEnd) {
        let opcoesMotoboy = '<option value="">Quem vai entregar?...</option>';
        if (typeof motoboysNoBanco !== 'undefined') {
            motoboysNoBanco.forEach(m => {
                opcoesMotoboy += `<option value="${m.nome}">${m.nome}</option>`;
            });
        }
        actHTML = `
            <select id="select-moto-${id}" style="flex: 2; padding: 10px; border-radius: 6px; background: var(--bg-main); color: white; border: 1px solid var(--border-color); font-size: 14px; outline: none;">
                ${opcoesMotoboy}
            </select>
            <button class="btn-action" style="flex: 1; background:var(--text-green); color:#000;" onclick="despacharComMotoboy('${id}')">🛵 Despachar</button>
        `;
    }
    
    else if(pedido.status === "Pronto") actHTML = `<button class="btn-action" style="background:var(--text-purple); color:#000;" onclick="mudarStatusFechando('${id}', 'Finalizado')">🤝 Entregue ao Cliente</button>`;
    else if(pedido.status === "Saiu para Entrega") actHTML = `<button class="btn-action" style="background:var(--text-purple); color:#000;" onclick="mudarStatusFechando('${id}', 'Finalizado')">✅ Confirmar Entrega</button>`;
    
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

        // --- MÁGICA DO ESTOQUE DE PÃES AUTOMÁTICO ---
        if (novoStatus === 'Pronto') {
            const pedido = dadosCompletosMemoria[idDoPedido];
            
            // Garante que só desconta 1 vez por pedido (proteção contra cliques duplos)
            if (pedido && !pedido.paesDescontados && pedido.itens) {
                let paesConsumidos = 0;
                
                pedido.itens.forEach(item => {
                    // Procura o item no banco de dados para confirmar se ele pertence à categoria que usa pão
                    const produtoOriginal = produtosNoBanco.find(p => p.idProduto === item.idProdutoOriginal || p.nome === item.nome.replace(' (Personalizado)', ''));
                    if (produtoOriginal && (produtoOriginal.categoria === 'Hamburguers' || produtoOriginal.categoria === 'Sanduíches')) {
                        paesConsumidos += item.quantidade;
                    }
                });

                if (paesConsumidos > 0) {
                    // Desconta do estoque global usando a matemática segura do Firebase (increment negativo)
                    await updateDoc(doc(db, "configuracoes", "loja"), {
                        estoquePaes: increment(-paesConsumidos)
                    });
                }

                // --- MÁGICA DO ESTOQUE INDIVIDUAL (BEBIDAS E PORÇÕES) ---
                for (const item of pedido.itens) {
                    const produtoOriginal = produtosNoBanco.find(p => p.idProduto === item.idProdutoOriginal || p.nome === item.nome.replace(' (Personalizado)', ''));
                    // Se este produto tiver controle de estoque ativo (número diferente de nulo), desconta!
                    if (produtoOriginal && produtoOriginal.idFirebase && produtoOriginal.estoque !== undefined && produtoOriginal.estoque !== null) {
                        await updateDoc(doc(db, "produtos", produtoOriginal.idFirebase), {
                            estoque: increment(-item.quantidade)
                        });
                    }
                }

                // Marca no pedido que o estoque global já foi cobrado para não duplicar!
                pacoteAtualizacao.paesDescontados = true; 
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

// FUNÇÃO PARA DESPACHAR COM O MOTOBOY SELECIONADO
window.despacharComMotoboy = async function(id) {
    const select = document.getElementById(`select-moto-${id}`);
    const nomeMotoboy = select.value;
    
    if(!nomeMotoboy) return alert("⚠️ Selecione um motoboy na lista para poder despachar!");

    try {
        await updateDoc(doc(db, "pedidos", id), { 
            status: 'Saiu para Entrega',
            entregador: nomeMotoboy
        });
        fecharGaveta();
    } catch (erro) {
        alert("Erro ao despachar: " + erro);
    }
}

// ==========================================
// 🖨️ MEMÓRIA DA IMPRESSORA AUTOMÁTICA
let pedidosJaImpressos = new Set();
let primeiraCargaDoPainel = true;
// ==========================================

const qPedidos = query(collection(db, "pedidos"), orderBy("dataCriacao", "asc"));
onSnapshot(qPedidos, (snapshot) => {
    document.getElementById('lista-pendente').innerHTML = ''; document.getElementById('lista-preparo').innerHTML = '';
    document.getElementById('lista-pronto').innerHTML = ''; document.getElementById('lista-entrega').innerHTML = '';
    document.getElementById('lista-finalizado').innerHTML = '';
    
    window.pedidosFinalizadosIds = []; dadosCompletosMemoria = {};
    let contagens = { pendente: 0, preparo: 0, pronto: 0, entrega: 0, finalizado: 0 };
    let totalReceitaCalculada = 0; let totalPedidosCalculados = 0;

    snapshot.forEach((documento) => {
        const pedido = documento.data(); const id = documento.id;
        
        // 🚨 FILTRO DE TURNO: Se o pedido foi feito antes do caixa abrir, ignora e pula pro próximo!
        if (pedido.dataCriacao < timestampAberturaCaixa) return; 

        // ==========================================
        // 🖨️ GATILHO: SE CHEGOU PEDIDO NOVO, IMPRIME!
        // ==========================================
        if (!primeiraCargaDoPainel && pedido.status === "Pendente" && !pedidosJaImpressos.has(id)) {
            setTimeout(() => { imprimirComanda(id); }, 1500); // Espera 1.5s para renderizar e imprime
        }
        pedidosJaImpressos.add(id); // Guarda na memória para não imprimir duplicado
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
            let nomes = pedido.itens.map(i => i.nome.replace(' (Personalizado)', '')).join(', ');
            if(nomes.length > 32) nomes = nomes.substring(0, 32) + '...';
            resumoItens = `<div style="font-size: 11px; color: var(--text-muted); margin-bottom: 12px; background: rgba(0,0,0,0.3); padding: 8px; border-radius: 6px;">📦 ${qtdTotal} item(s): ${nomes}</div>`;
        }

        const card = document.createElement('div'); card.className = 'card-mini'; card.onclick = () => abrirGaveta(id);
        card.innerHTML = `
            <div class="card-top" style="margin-bottom: 10px;">
                <span class="tag ${tagClass}" style="padding: 4px 8px;">${tagTxt}</span>
                <span class="card-timer" style="font-size: 11px;">⏰ ${new Date(pedido.dataCriacao).toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})}</span>
            </div>
            <div class="card-client" style="font-size: 16px; margin-bottom: 8px;">${pedido.cliente || 'Sem Nome'}</div>
            ${resumoItens}
            <div class="card-info" style="border-top: 1px dashed var(--border-color); padding-top: 10px; margin-top: auto;">
                <span class="card-id">#${id.substring(0,5).toUpperCase()}</span>
                <strong style="color: white; font-size: 15px;">${pedido.totalGeral}</strong>
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
    grid.innerHTML = '';
    motoboysNoBanco = [];

    snapshot.forEach((docSnap) => {
        const moto = docSnap.data();
        const id = docSnap.id;
        motoboysNoBanco.push({ id, ...moto });

        grid.innerHTML += `
            <div class="item-row" style="display: flex; justify-content: space-between; align-items: center; background: var(--bg-card);">
                <div>
                    <strong style="color: white;">${moto.nome}</strong><br>
                    <span style="font-size: 12px; color: var(--text-muted);">${moto.telefone} | ${moto.placa || 'Sem placa'}</span>
                </div>
                <button onclick="excluirMotoboy('${id}')" style="background: none; border: none; cursor: pointer; font-size: 18px;">🗑️</button>
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
                    <td style="padding: 12px 10px; font-weight: bold; color: white;">${p.cliente || 'Sem Nome'}</td>
                    <td style="padding: 12px 10px; color: var(--text-muted);">${dataStr}</td>
                    <td style="padding: 12px 10px; color: var(--text-green); font-weight: bold;">${p.totalGeral}</td>
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
    const idFirebase = document.getElementById('pdv-produto').value;
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
    
    // Reseta a quantidade
    document.getElementById('pdv-qtd').value = 1;
    atualizarListaPDV();
}

window.removerItemPDV = function(index) {
    carrinhoPDV.splice(index, 1);
    atualizarListaPDV();
}

window.atualizarListaPDV = function() {
    const lista = document.getElementById('pdv-lista-itens');
    lista.innerHTML = '';
    
    if(carrinhoPDV.length === 0) {
        lista.innerHTML = '<span style="color: #666; font-size: 13px; font-style: italic;">Nenhum item adicionado à comanda.</span>';
        calcularTotalPDV();
        return;
    }

    carrinhoPDV.forEach((item, index) => {
        const subtotalItem = item.preco * item.quantidade;
        lista.innerHTML += `
            <div style="display: flex; justify-content: space-between; align-items: center; background: var(--bg-card); padding: 10px; border-radius: 6px; border: 1px solid #444; font-size: 14px; color: white;">
                <span><strong style="color: var(--text-orange); margin-right: 5px;">${item.quantidade}x</strong> ${item.nome}</span>
                <div style="display: flex; gap: 12px; align-items: center;">
                    <span style="color: var(--text-green); font-weight: bold;">R$ ${subtotalItem.toFixed(2).replace('.', ',')}</span>
                    <button onclick="removerItemPDV(${index})" style="background: var(--soft-red); border: none; border-radius: 4px; padding: 4px 8px; color: var(--text-red); cursor: pointer; font-size: 14px;">🗑️</button>
                </div>
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
    const whats = document.getElementById('manual-whats').value.trim();
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
        itens: [...carrinhoPDV], // Joga o carrinho inteiro aqui dentro!
        status: "Pendente",
        dataCriacao: Date.now()
    };

    const btn = document.querySelector('#tela-novo-pedido .btn-salvar-lanche');
    btn.innerText = "⏳ Imprimindo comanda...";
    btn.disabled = true;

    try {
        // Envia para o banco e captura o ID do pedido gerado na hora
        const docRef = await addDoc(collection(db, "pedidos"), pacote);
        
        // 🖨️ MÁGICA DA IMPRESSÃO IMEDIATA
        // Alimentamos a memória e evitamos que o radar automático duplique a impressão
        pedidosJaImpressos.add(docRef.id); 
        dadosCompletosMemoria[docRef.id] = pacote;
        imprimirComanda(docRef.id); 

        // Esvazia tudo para o próximo pedido
        document.getElementById('manual-nome').value = '';
        document.getElementById('manual-whats').value = '';
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
        btn.innerText = "✅ Enviar para a Cozinha";
        btn.disabled = false;
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
                    <span style="flex: 1; padding-right: 10px;"><b>${item.quantidade}x</b> ${item.nome.replace(' (Personalizado)', '')}</span>
                    <span style="font-weight: bold; white-space: nowrap;">${pco}</span>
                </div>
            `;
            
            if(item.listaAdicionais && item.listaAdicionais.length > 0) {
                // Coloca um adicional por linha para ficar fácil da cozinha ler
                itensHtml += `<div style="font-size: 12px; padding-left: 20px;">+ ${item.listaAdicionais.join('<br>+ ')}</div>`;
            }
            if(item.obs && item.obs.trim() !== '') {
                itensHtml += `<div style="font-size: 12px; font-weight: bold; padding-left: 20px;">* Obs: ${item.obs}</div>`;
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
            <div style="text-align: center; font-size: 12px; margin-bottom: 2px;">Pedido: #${id.substring(0,6).toUpperCase()}</div>
            <div style="text-align: center; font-size: 12px; margin-bottom: 10px;">${dataFormatada}</div>
            
            <div class="linha-tracejada"></div>
            
            <div style="font-size: 14px; margin-bottom: 4px;"><b>Cliente:</b> ${pedido.cliente}</div>
            <div style="font-size: 14px; margin-bottom: 4px;"><b>Tipo:</b> ${pedido.tipo.toUpperCase()}</div>
            ${pedido.tipo === 'entrega' ? `<div style="font-size: 14px; margin-bottom: 4px;"><b>Endereço:</b> ${pedido.endereco}</div>` : ''}
            <div style="font-size: 14px; margin-bottom: 10px;"><b>Pgto:</b> ${pagamentoTexto}</div>
            
            <div class="linha-tracejada"></div>
            <div style="font-size: 14px; font-weight: bold; text-align: center; margin-bottom: 10px;">ITENS DO PEDIDO</div>
            
            <div style="margin-bottom: 10px;">
                ${itensHtml}
            </div>
            
            <div class="linha-tracejada"></div>
            
            ${pedido.observacoes && pedido.observacoes !== 'Nenhuma' ? `<div style="font-size: 14px; margin-bottom: 10px; border: 1px solid black; padding: 6px;"><b>OBS GERAIS:</b><br>${pedido.observacoes}</div><div class="linha-tracejada"></div>` : ''}
            
            ${pedido.subtotal ? `<div class="flex-row"><span>Subtotal:</span><span>${pedido.subtotal}</span></div>` : ''}
            ${pedido.tipo === 'entrega' && pedido.taxaEntrega ? `<div class="flex-row"><span>Taxa de Entrega:</span><span>${pedido.taxaEntrega}</span></div>` : ''}
            
            <div class="flex-row" style="margin-top: 10px; font-size: 18px; font-weight: bold;">
                <span>TOTAL:</span>
                <span>${pedido.totalGeral}</span>
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
// MÓDULO DE ESTOQUE DE PÃES (AO VIVO)
// ==========================================

// 1. Fica a escutar o Firebase para atualizar o visor na hora
onSnapshot(doc(db, "configuracoes", "loja"), (documento) => {
    if (documento.exists()) {
        const dadosLoja = documento.data();
        const visor = document.getElementById('visor-paes');
        
        if (visor && dadosLoja.estoquePaes !== undefined) {
            visor.innerText = dadosLoja.estoquePaes + " unidades";
            
            // Alerta de estoque baixo: Fica vermelho se tiver 10 pães ou menos
            if(dadosLoja.estoquePaes <= 10) {
                visor.style.color = "var(--text-red)";
            } else {
                visor.style.color = "var(--text-main)";
            }
        }
    }
});

// 2. Função do Botão para o Gestor digitar os pães do dia
window.definirEstoque = async function() {
    const qtd = prompt("🍔 Quantos pães físicos você tem agora para iniciar o turno?");
    
    // Verifica se o gestor digitou um número válido
    if (qtd !== null && qtd.trim() !== "" && !isNaN(qtd)) {
        try {
            await updateDoc(doc(db, "configuracoes", "loja"), {
                estoquePaes: parseInt(qtd)
            });
            alert(`✅ Estoque iniciado com ${qtd} pães! O sistema vai abater automaticamente a cada hambúrguer vendido.`);
        } catch (error) {
            console.error("Erro ao atualizar estoque:", error);
            alert("Erro ao atualizar o estoque. Verifique sua internet.");
        }
    }
}

// COLE NO FINAL DO GESTOR.JS
let estoqueMaximo = localStorage.getItem('estoque_max_dia') || 100;

onSnapshot(doc(db, "configuracoes", "loja"), (docSnap) => {
    if (docSnap.exists()) {
        const dados = docSnap.data();
        const visor = document.getElementById('visor-paes');
        const barra = document.getElementById('barra-progresso-paes');
        const txtPercent = document.getElementById('status-percent');

        if (visor && dados.estoquePaes !== undefined) {
            const atual = dados.estoquePaes;
            visor.innerText = atual;

            // Cálculo da barra com Trava Anti-Bug (Novo)
            let perc = Math.round((atual / estoqueMaximo) * 100);
            
            // Se a matemática der erro (NaN), força para 0
            if (isNaN(perc)) perc = 0; 
            
            if (perc > 100) perc = 100;
            if (perc < 0) perc = 0;

            barra.style.width = perc + "%";
            txtPercent.innerText = perc + "%";

            // Cores dinâmicas
            if (perc > 50) {
                barra.style.background = "var(--text-green)";
                txtPercent.style.color = "var(--text-green)";
                txtPercent.style.background = "var(--soft-green)";
            } else if (perc > 20) {
                barra.style.background = "var(--text-orange)";
                txtPercent.style.color = "var(--text-orange)";
                txtPercent.style.background = "var(--soft-orange)";
            } else {
                barra.style.background = "var(--text-red)";
                txtPercent.style.color = "var(--text-red)";
                txtPercent.style.background = "var(--soft-red)";
            }
        }
    }
});

window.definirEstoque = async function() {
    const qtd = prompt("🍔 Quantos pães você tem agora para iniciar o turno?");
    if (qtd && !isNaN(qtd)) {
        estoqueMaximo = parseInt(qtd);
        localStorage.setItem('estoque_max_dia', qtd);
        try {
            await updateDoc(doc(db, "configuracoes", "loja"), { estoquePaes: estoqueMaximo });
            alert("Estoque iniciado!");
        } catch (e) { alert("Erro ao salvar estoque."); }
    }
};

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
            <div class="item-row" style="display: flex; justify-content: space-between; align-items: center; background: var(--bg-card);">
                <div>
                    <strong style="color: white;">${b.nome}</strong><br>
                    <span style="font-size: 12px; color: ${corTaxa}; font-weight: bold;">Taxa: ${taxaTexto}</span>
                </div>
                <button onclick="excluirBairro('${id}')" style="background: none; border: none; cursor: pointer; font-size: 18px;">🗑️</button>
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