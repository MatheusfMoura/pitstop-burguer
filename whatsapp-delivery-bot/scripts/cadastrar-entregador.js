'use strict';

const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');

const [, , nomeInformado, telefoneInformado] = process.argv;
const nome = String(nomeInformado || '').trim();
const telefone = String(telefoneInformado || '').replace(/\D/g, '');

if (!nome || telefone.length < 6) {
  console.error('Uso: npm run cadastrar-entregador -- "Nome Completo" "68999999999"');
  process.exit(1);
}

function emailTecnicoMotoboy(valor) {
  const identificador = valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');

  return `${identificador}@entregadores.pitstop.local`;
}

const chaveLocal = path.join(__dirname, '..', 'serviceAccountKey.json');
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT
  ? path.resolve(process.cwd(), process.env.FIREBASE_SERVICE_ACCOUNT)
  : fs.existsSync(chaveLocal)
    ? chaveLocal
    : path.join(__dirname, '..', '..', 'firebase-key.json');

admin.initializeApp({
  credential: admin.credential.cert(require(serviceAccountPath))
});

async function executar() {
  const email = emailTecnicoMotoboy(nome);
  let usuario;

  try {
    usuario = await admin.auth().getUserByEmail(email);
    usuario = await admin.auth().updateUser(usuario.uid, {
      password: telefone,
      displayName: nome,
      disabled: false
    });
  } catch (erro) {
    if (erro.code !== 'auth/user-not-found') throw erro;
    usuario = await admin.auth().createUser({
      email,
      password: telefone,
      displayName: nome,
      emailVerified: true
    });
  }

  await admin.auth().setCustomUserClaims(usuario.uid, {
    entregador: true,
    entregadorNome: nome
  });

  const existentes = await admin.firestore()
    .collection('motoboys')
    .where('nome', '==', nome)
    .limit(1)
    .get();

  if (existentes.empty) {
    await admin.firestore().collection('motoboys').add({ nome, telefone });
  } else {
    await existentes.docs[0].ref.update({ telefone });
  }

  console.log(`Entregador "${nome}" autorizado com o login ${email}`);
}

executar()
  .then(() => admin.app().delete())
  .catch((erro) => {
    console.error(erro);
    process.exit(1);
  });
