'use strict';

const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
const admin = require('firebase-admin');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');

const CONFIG = {
  colecaoPedidos: process.env.FIRESTORE_PEDIDOS_COLLECTION || 'pedidos',
  statusEmPreparo: process.env.STATUS_EM_PREPARO || 'Em Preparo',
  statusSaiuParaEntrega: process.env.STATUS_SAIU_ENTREGA || 'Saiu para Entrega',
  restauranteNome: process.env.RESTAURANTE_NOME || 'Pitstop Burguer',
  pedidoTesteId: process.env.PEDIDO_TESTE_ID || null,
  modoSimulacao: process.env.MODO_SIMULACAO === 'true',
  campos: {
    clienteNome: 'cliente',
    clienteWhatsapp: 'whatsapp',
    numeroPedido: 'numeroDiario',
    status: 'status'
  }
};

const AVISOS = [
  {
    id: 'preparo',
    statusPedido: CONFIG.statusEmPreparo,
    campos: {
      enviado: 'whatsappPreparoEnviado',
      enviadoEm: 'whatsappPreparoEnviadoEm',
      status: 'whatsappPreparoStatus',
      erro: 'whatsappPreparoErro',
      reservaToken: 'whatsappPreparoReservaToken',
      reservaEm: 'whatsappPreparoReservaEm'
    },
    montarMensagem(doc, dados) {
      const nome = dados[CONFIG.campos.clienteNome] || 'cliente';
      const numero = numeroPedidoParaMensagem(doc, dados);
      return `Olá, ${nome}! 🍽️

Seu pedido #${numero} já começou a ser preparado.
Nossa equipe está cuidando de tudo com muito carinho. 👨‍🍳

Obrigado pela preferência!
${CONFIG.restauranteNome}`;
    }
  },
  {
    id: 'saiu_entrega',
    statusPedido: CONFIG.statusSaiuParaEntrega,
    campos: {
      enviado: 'whatsappSaiuEntregaEnviado',
      enviadoEm: 'whatsappSaiuEntregaEnviadoEm',
      status: 'whatsappStatus',
      erro: 'whatsappErro',
      reservaToken: 'whatsappReservaToken',
      reservaEm: 'whatsappReservaEm'
    },
    montarMensagem(doc, dados) {
      const nome = dados[CONFIG.campos.clienteNome] || 'cliente';
      const numero = numeroPedidoParaMensagem(doc, dados);
      return `Olá, ${nome}! 🍽️

Seu pedido #${numero} saiu para entrega.
O entregador já está a caminho. 🛵

Obrigado pela preferência!
${CONFIG.restauranteNome}`;
    }
  }
];

const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT
  ? path.resolve(process.cwd(), process.env.FIREBASE_SERVICE_ACCOUNT)
  : fs.existsSync(path.join(__dirname, 'serviceAccountKey.json'))
    ? path.join(__dirname, 'serviceAccountKey.json')
    : path.join(__dirname, '..', 'firebase-key.json');

const serviceAccount = require(serviceAccountPath);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const pedidos = db.collection(CONFIG.colecaoPedidos);
const statusBotRef = db.doc('configuracoes/whatsappBot');
const unsubscribePedidos = [];
let unsubscribeComandos = null;
let heartbeatTimer = null;
let comandoEmExecucao = false;
let comandoPendente = null;
let clienteWhatsAppDisponivel = false;
const processandoLocalmente = new Set();
const authSessionPath = path.join(__dirname, '.wwebjs_auth', 'session-restaurante-01');

const client = new Client({
  authStrategy: new LocalAuth({
    clientId: 'restaurante-01',
    dataPath: path.join(__dirname, '.wwebjs_auth')
  }),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage'
    ]
  }
});

function log(nivel, mensagem, detalhes = '') {
  const complemento = detalhes ? ` ${detalhes}` : '';
  console.log(`[${new Date().toISOString()}] [${nivel}] ${mensagem}${complemento}`);
}

async function publicarStatus(status, extras = {}) {
  try {
    await statusBotRef.set({
      status,
      atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
      pid: process.pid,
      ...extras
    }, { merge: true });
  } catch (erro) {
    log('ERRO', 'Falha ao publicar status do bot:', erro.message);
  }
}

function iniciarHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    publicarStatus('conectado', {
      heartbeatEm: admin.firestore.FieldValue.serverTimestamp()
    });
  }, 30000);
}

function pararHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

async function processarComando(comando) {
  if (!comando || !comando.id || comandoEmExecucao) return;

  if (comando.tipo === 'novo_qr' && !clienteWhatsAppDisponivel) {
    comandoPendente = comando;
    return;
  }

  comandoEmExecucao = true;
  comandoPendente = null;

  try {
    log('INFO', `Processando comando do painel: ${comando.tipo}`);
    await statusBotRef.set({
      comando: null,
      ultimoComandoId: comando.id,
      ultimoComandoTipo: comando.tipo,
      ultimoComandoEm: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    if (comando.tipo === 'reiniciar') {
      await publicarStatus('reiniciando', { qrCodeDataUrl: null, erro: null });
      setTimeout(() => process.exit(1), 1000);
      return;
    }

    if (comando.tipo === 'novo_qr') {
      await publicarStatus('desvinculando', { qrCodeDataUrl: null, erro: null });
      await client.logout();
      setTimeout(() => process.exit(1), 1000);
      return;
    }

    log('ERRO', 'Comando desconhecido:', comando.tipo);
  } catch (erro) {
    log('ERRO', 'Falha ao processar comando do painel:', erro.message);
    await publicarStatus('erro', { erro: erro.message });
    comandoEmExecucao = false;
  }
}

function monitorarComandos() {
  if (unsubscribeComandos) return;
  unsubscribeComandos = statusBotRef.onSnapshot((snapshot) => {
    if (!snapshot.exists) return;
    processarComando(snapshot.data().comando);
  }, (erro) => log('ERRO', 'Falha ao monitorar comandos:', erro.message));
}

function limparTravasSessaoOrfas() {
  const lockPath = path.join(authSessionPath, 'SingletonLock');
  try {
    fs.lstatSync(lockPath);
  } catch (erro) {
    if (erro.code === 'ENOENT') return;
    throw erro;
  }

  let processoExiste = false;
  try {
    const destino = fs.readlinkSync(lockPath);
    const pid = Number(destino.match(/-(\d+)$/)?.[1]);
    if (pid) {
      process.kill(pid, 0);
      processoExiste = true;
    }
  } catch (erro) {
    if (erro.code !== 'ESRCH' && erro.code !== 'EINVAL' && erro.code !== 'ENOENT') {
      throw erro;
    }
  }

  if (processoExiste) return;

  for (const nome of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    try {
      fs.unlinkSync(path.join(authSessionPath, nome));
    } catch (erro) {
      if (erro.code !== 'ENOENT') throw erro;
    }
  }
  log('INFO', 'Travas orfas da sessao do Chrome removidas');
}

function formatarNumeroBrasileiro(numero) {
  const somenteNumeros = String(numero || '').replace(/\D/g, '');
  if (!somenteNumeros) {
    throw new Error('Pedido sem numero de WhatsApp');
  }

  const comPais = somenteNumeros.startsWith('55')
    ? somenteNumeros
    : `55${somenteNumeros}`;

  return `${comPais}@c.us`;
}

async function resolverDestinatario(numero) {
  const numeroFormatado = formatarNumeroBrasileiro(numero);
  const idRegistrado = await client.getNumberId(numeroFormatado);
  if (!idRegistrado) {
    throw new Error(`Numero ${numeroFormatado} nao esta registrado no WhatsApp`);
  }

  return idRegistrado._serialized || numeroFormatado;
}

function numeroPedidoParaMensagem(doc, dados) {
  const numero = dados[CONFIG.campos.numeroPedido];
  return numero !== undefined && numero !== null
    ? String(numero).padStart(3, '0')
    : doc.id.substring(0, 6).toUpperCase();
}

async function reservarEnvio(doc, aviso) {
  const token = randomUUID();
  const campos = aviso.campos;

  const reservado = await db.runTransaction(async (transaction) => {
    const atual = await transaction.get(doc.ref);
    if (!atual.exists) return false;

    const dados = atual.data();
    const elegivel =
      dados[CONFIG.campos.status] === aviso.statusPedido &&
      dados[campos.enviado] === false &&
      (!dados[campos.status] || dados[campos.status] === 'pendente');

    if (!elegivel) return false;

    transaction.update(doc.ref, {
      [campos.status]: 'processando',
      [campos.erro]: null,
      [campos.reservaToken]: token,
      [campos.reservaEm]: admin.firestore.FieldValue.serverTimestamp()
    });

    return true;
  });

  return reservado ? token : null;
}

async function concluirEnvio(docRef, token, aviso) {
  const campos = aviso.campos;
  await db.runTransaction(async (transaction) => {
    const atual = await transaction.get(docRef);
    if (!atual.exists || atual.data()[campos.reservaToken] !== token) return;

    transaction.update(docRef, {
      [campos.enviado]: true,
      [campos.enviadoEm]: admin.firestore.FieldValue.serverTimestamp(),
      [campos.status]: 'enviado',
      [campos.erro]: null,
      [campos.reservaToken]: null,
      [campos.reservaEm]: null
    });
  });
}

async function registrarErro(docRef, token, erro, aviso) {
  const mensagem = String(erro && erro.message ? erro.message : erro).slice(0, 1000);
  const campos = aviso.campos;

  await db.runTransaction(async (transaction) => {
    const atual = await transaction.get(docRef);
    if (!atual.exists || atual.data()[campos.reservaToken] !== token) return;

    transaction.update(docRef, {
      [campos.status]: 'erro',
      [campos.erro]: mensagem,
      [campos.reservaToken]: null,
      [campos.reservaEm]: null
    });
  });
}

async function enviarAviso(doc, aviso) {
  const chaveProcessamento = `${aviso.id}:${doc.id}`;
  if (processandoLocalmente.has(chaveProcessamento)) return;
  processandoLocalmente.add(chaveProcessamento);

  let token = null;
  try {
    token = await reservarEnvio(doc, aviso);
    if (!token) return;

    const atual = await doc.ref.get();
    const dados = atual.data();
    const destinatario = await resolverDestinatario(dados[CONFIG.campos.clienteWhatsapp]);
    const mensagem = aviso.montarMensagem(doc, dados);

    if (CONFIG.modoSimulacao) {
      log('SIMULACAO', `Aviso ${aviso.id} do pedido ${doc.id} seria enviado para`, destinatario);
      await registrarErro(doc.ref, token, new Error('Simulacao: mensagem nao enviada'), aviso);
      return;
    }

    log('INFO', `Enviando aviso ${aviso.id} do pedido ${doc.id} para`, destinatario);
    await client.sendMessage(destinatario, mensagem);
    await concluirEnvio(doc.ref, token, aviso);
    log('OK', `Aviso ${aviso.id} do pedido ${doc.id} enviado`);
  } catch (erro) {
    log('ERRO', `Falha ao enviar aviso ${aviso.id} do pedido ${doc.id}:`, erro.message || String(erro));
    if (token) {
      try {
        await registrarErro(doc.ref, token, erro, aviso);
      } catch (erroFirestore) {
        log('ERRO', `Falha ao registrar erro do pedido ${doc.id}:`, erroFirestore.message);
      }
    }
  } finally {
    processandoLocalmente.delete(chaveProcessamento);
  }
}

function monitorarPedidos() {
  if (unsubscribePedidos.length) return;

  for (const aviso of AVISOS) {
    const consulta = pedidos
      .where(CONFIG.campos.status, '==', aviso.statusPedido)
      .where(aviso.campos.enviado, '==', false);

    unsubscribePedidos.push(consulta.onSnapshot(
      (snapshot) => {
        for (const mudanca of snapshot.docChanges()) {
          if (mudanca.type === 'removed') continue;
          if (CONFIG.pedidoTesteId && mudanca.doc.id !== CONFIG.pedidoTesteId) continue;
          enviarAviso(mudanca.doc, aviso);
        }
      },
      (erro) => log('ERRO', `Falha ao monitorar aviso ${aviso.id}:`, erro.message)
    ));
    log('INFO', `Monitorando aviso ${aviso.id} em "${CONFIG.colecaoPedidos}"`);
  }
}

client.on('qr', (qr) => {
  log('INFO', 'Escaneie o QR Code abaixo no WhatsApp do restaurante:');
  qrcode.generate(qr, { small: true });
  QRCode.toDataURL(qr, { width: 360, margin: 2 })
    .then((qrCodeDataUrl) => publicarStatus('aguardando_qr', {
      qrCodeDataUrl,
      qrGeradoEm: admin.firestore.FieldValue.serverTimestamp(),
      erro: null
    }))
    .catch((erro) => log('ERRO', 'Falha ao gerar imagem do QR:', erro.message));
});

client.on('loading_screen', (porcentagem, mensagem) => {
  log('INFO', `Carregando WhatsApp ${porcentagem}%:`, mensagem);
});
client.on('authenticated', () => {
  log('OK', 'WhatsApp autenticado');
  clienteWhatsAppDisponivel = true;
  publicarStatus('autenticado', { erro: null });
  if (comandoPendente) processarComando(comandoPendente);
});
client.on('auth_failure', (erro) => {
  log('ERRO', 'Falha de autenticacao:', erro);
  publicarStatus('erro_autenticacao', { erro: String(erro) });
});
client.on('change_state', (estado) => log('INFO', 'Estado do WhatsApp:', estado));
client.on('ready', () => {
  log('OK', 'WhatsApp conectado e pronto');
  publicarStatus('conectado', {
    conectadoEm: admin.firestore.FieldValue.serverTimestamp(),
    heartbeatEm: admin.firestore.FieldValue.serverTimestamp(),
    qrCodeDataUrl: null,
    erro: null
  });
  iniciarHeartbeat();
  monitorarPedidos();
});
client.on('disconnected', (motivo) => {
  log('ERRO', 'WhatsApp desconectado:', motivo);
  clienteWhatsAppDisponivel = false;
  pararHeartbeat();
  publicarStatus('desconectado', { erro: String(motivo), qrCodeDataUrl: null });
  while (unsubscribePedidos.length) unsubscribePedidos.pop()();
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 1000);
});

async function encerrar(sinal) {
  log('INFO', `Encerrando por ${sinal}`);
  pararHeartbeat();
  while (unsubscribePedidos.length) unsubscribePedidos.pop()();
  if (unsubscribeComandos) unsubscribeComandos();
  await publicarStatus('offline', { erro: null });
  await client.destroy();
  process.exit(0);
}

process.on('SIGINT', () => encerrar('SIGINT'));
process.on('SIGTERM', () => encerrar('SIGTERM'));
process.on('unhandledRejection', (erro) => log('ERRO', 'Promise rejeitada:', erro));

log('INFO', 'Iniciando whatsapp-delivery-bot');
if (CONFIG.pedidoTesteId) {
  log('INFO', `Modo de teste limitado ao pedido ${CONFIG.pedidoTesteId}`);
}
if (CONFIG.modoSimulacao) {
  log('INFO', 'Modo de simulacao ativo: nenhuma mensagem sera enviada');
}
limparTravasSessaoOrfas();
publicarStatus('iniciando', { erro: null });
monitorarComandos();
client.initialize();

module.exports = {
  formatarNumeroBrasileiro,
  enviarAviso,
  monitorarPedidos
};
