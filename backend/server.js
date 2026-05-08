const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

// Pega o "Crachá VIP" que renomeamos
const serviceAccount = require('./firebase-key.json');

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

        // LÓGICA DE ESTOQUE: DESCONTO DOS PÃES
        let paesConsumidos = 0;
        if(pacoteDeDados.itens) {
            pacoteDeDados.itens.forEach(item => {
                // Inteligência: Só desconta se a categoria for "Hamburguers"
                // Ignora automaticamente batatas, porções e bebidas!
                if (item.categoria === "Hamburguers") {
                    paesConsumidos += item.quantidade;
                }
            });
        }

        // Se o pedido consumiu algum pão, manda o Firebase subtrair de forma segura
        if (paesConsumidos > 0) {
            const configRef = db.collection('configuracoes').doc('loja');
            await configRef.update({
                estoquePaes: admin.firestore.FieldValue.increment(-paesConsumidos)
            });
            console.log(`🍞 Descontando ${paesConsumidos} pães do estoque...`);
        }

        // Se o pedido consumiu algum pão, manda o Firebase subtrair de forma segura
        if (paesConsumidos > 0) {
            const configRef = db.collection('configuracoes').doc('loja');
            // O 'increment(-X)' subtrai o valor sem precisar ler o banco de dados antes!
            await configRef.update({
                estoquePaes: admin.firestore.FieldValue.increment(-paesConsumidos)
            });
            console.log(`🍞 Descontando ${paesConsumidos} pães do estoque...`);
        }

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