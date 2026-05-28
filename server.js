const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

const rooms = {};

// Génère un code unique de 6 caractères alphanumériques
function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

io.on('connection', (socket) => {
    console.log(`Joueur connecté : ${socket.id}`);

    // Création du salon
    socket.on('createRoom', (data) => {
        const roomCode = generateRoomCode();
        rooms[roomCode] = {
            id: roomCode,
            map: data.map,
            players: {}
        };
        
        socket.join(roomCode);
        rooms[roomCode].players[socket.id] = { id: socket.id, car: data.car, x: 0, z: 0, r: 0 };
        
        socket.emit('roomCreated', { roomCode, map: data.map });
    });

    // Rejoindre un salon via le code
    socket.on('joinRoom', (data) => {
        const roomCode = data.roomCode.toUpperCase();
        if (rooms[roomCode]) {
            socket.join(roomCode);
            rooms[roomCode].players[socket.id] = { id: socket.id, car: data.car, x: 10, z: 0, r: 0 };
            
            // On informe l'hôte et les autres
            io.to(roomCode).emit('initGame', rooms[roomCode]);
        } else {
            socket.emit('joinError', 'Code de salon invalide !');
        }
    });

    // Synchronisation des mouvements des voitures
    socket.on('updatePlayer', (data) => {
        if (rooms[data.roomCode] && rooms[data.roomCode].players[socket.id]) {
            rooms[data.roomCode].players[socket.id].x = data.x;
            rooms[data.roomCode].players[socket.id].z = data.z;
            rooms[data.roomCode].players[socket.id].r = data.r;
            
            // On envoie la position aux autres joueurs du salon
            socket.to(data.roomCode).emit('playerMoved', { id: socket.id, x: data.x, z: data.z, r: data.r });
        }
    });

    socket.on('disconnect', () => {
        console.log(`Joueur déconnecté : ${socket.id}`);
        // Nettoyage des salons vides si nécessaire
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Serveur actif sur le port ${PORT}`);
});
