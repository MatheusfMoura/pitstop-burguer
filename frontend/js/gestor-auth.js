import { initializeApp, getApp, getApps } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, getIdTokenResult, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyCUjBWv40J0Mp6KsHzWxOwz6hNyWDHOYT8",
    authDomain: "pitstop-burguer.firebaseapp.com",
    projectId: "pitstop-burguer",
    storageBucket: "pitstop-burguer.firebasestorage.app",
    messagingSenderId: "749099939746",
    appId: "1:749099939746:web:1716fc96eb83bb1f7724fb"
};

const ADMIN_EMAIL = "admin@lanchonete.com";
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const telaLogin = document.getElementById('tela-login-gestor');
const mensagemLogin = document.getElementById('mensagem-login-gestor');
let moduloGestorCarregado = false;
let validandoUsuario = null;

function bloquearPainel(mensagem = '') {
    document.body.classList.remove('gestor-autenticado');
    telaLogin.style.display = 'flex';
    if (mensagemLogin) mensagemLogin.textContent = mensagem;
}

async function liberarPainel(user) {
    if (validandoUsuario) return validandoUsuario;

    validandoUsuario = (async () => {
        const token = await getIdTokenResult(user, true);
        const autorizado = user.email === ADMIN_EMAIL && token.claims.admin === true;

        if (!autorizado) {
            await signOut(auth);
            bloquearPainel('Esta conta não possui permissão administrativa.');
            return;
        }

        if (!moduloGestorCarregado) {
            await import('./gestor.js?v=13');
            moduloGestorCarregado = true;
        }

        document.body.classList.add('gestor-autenticado');
        telaLogin.style.display = 'none';
    })();

    try {
        await validandoUsuario;
    } finally {
        validandoUsuario = null;
    }
}

window.entrarGestor = async function() {
    const senha = document.getElementById('senha-gestor').value;
    const btn = document.querySelector('#tela-login-gestor button');

    if (!senha) return alert("Preencha a sua senha!");

    btn.innerText = "Desbloqueando...";
    btn.disabled = true;
    if (mensagemLogin) mensagemLogin.textContent = '';

    try {
        await signInWithEmailAndPassword(auth, ADMIN_EMAIL, senha);
    } catch (erro) {
        console.error('Falha no login do gestor:', erro);
        bloquearPainel('Acesso negado. Verifique a senha e tente novamente.');
        document.getElementById('senha-gestor').value = '';
    } finally {
        btn.innerText = "Desbloquear";
        btn.disabled = false;
    }
};

window.sairGestor = async function() {
    if (!confirm("Deseja trancar o caixa e desconectar do servidor?")) return;
    await signOut(auth);
    window.location.reload();
};

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        bloquearPainel();
        return;
    }

    try {
        await liberarPainel(user);
    } catch (erro) {
        console.error('Falha ao validar autorização administrativa:', erro);
        await signOut(auth);
        bloquearPainel('Não foi possível validar sua permissão. Entre novamente.');
    }
});
