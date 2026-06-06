const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const path = require('path');

const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT
  ? path.resolve(process.cwd(), process.env.FIREBASE_SERVICE_ACCOUNT)
  : path.join(__dirname, '..', 'firebase-key.json');
const serviceAccount = require(serviceAccountPath);

// Inicializa o Firebase
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const app = express();
const PORTA = 3000;

app.use(cors());
app.use(express.json());

// ROTAS
app.get('/', (req, res) => {
    res.send('Servidor do Pitstop Burguer está rodando liso com Firebase! 🔥🍔');
});

// Rota para salvar o pedido
app.post('/api/pedidos', async (req, res) => {
    try {
        const pacoteDeDados = req.body;
        console.log("🔔 Recebendo pedido de:", pacoteDeDados.cliente);

        // Lógica de estoque de pães engessada removida.
        // O estoque agora é gerido item a item de forma dinâmica pelo KDS!

        // Carimba a data exata e o status
        pacoteDeDados.dataCriacao = admin.firestore.FieldValue.serverTimestamp();
        pacoteDeDados.status = 'Pendente';

        // Salva na "pasta" de pedidos do Firebase
        const novoPedidoRef = await db.collection('pedidos').add(pacoteDeDados);

        console.log("✅ Pedido salvo com sucesso! ID:", novoPedidoRef.id);
        
        res.status(201).json({ 
            sucesso: true, 
            mensagem: "Pedido salvo no banco de dados!",
            idPedido: novoPedidoRef.id 
        });

    } catch (erro) {
        console.error("❌ Erro ao salvar no Firebase:", erro);
        res.status(500).json({ sucesso: false, mensagem: "Erro interno no servidor." });
    }
});

// status do node server.js quando abrir ^^
app.listen(PORTA, () => {
    console.log(`🚀 Servidor voando na porta http://localhost:${PORTA}`);
    console.log(`🔥 Firebase conectado com sucesso sem bloqueios!`);
});
