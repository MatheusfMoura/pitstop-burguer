// backend/models/Pedido.js
const mongoose = require('mongoose');

// Criamos o "Molde" (Schema) do que é um pedido válido
const PedidoSchema = new mongoose.Schema({
    cliente: { type: String, required: true },
    tipo: { type: String, required: true }, // entrega, local, retirada
    endereco: { type: String },
    pagamento: { type: String, required: true },
    observacoes: { type: String },
    subtotal: { type: String },
    taxaEntrega: { type: String },
    totalGeral: { type: String, required: true },
    
    // O array de itens que o cliente comprou
    itens: [{
        id: Number,
        nome: String,
        quantidade: Number,
        preco: Number
    }],

    // Campos de controle interno da lanchonete
    status: { type: String, default: 'Pendente' }, // Pendente, Preparando, Saiu para Entrega, Finalizado
    dataCriacao: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Pedido', PedidoSchema);