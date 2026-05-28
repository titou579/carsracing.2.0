const socket = io();

let currentRoomCode = "";
let myCarColor = "red";
let selectedMap = "circuit";
let botCount = 0;

// Créer un salon
document.getElementById('btn-create').addEventListener('click', () => {
    myCarColor = document.getElementById('car-select').value;
    selectedMap = document.getElementById('map-select').value;
    botCount = parseInt(document.getElementById('bots-select').value);
    
    socket.emit('createRoom', { car: myCarColor, map: selectedMap });
});

// Rejoindre un salon existant
document.getElementById('btn-join').addEventListener('click', () => {
    const codeInput = document.getElementById('join-code').value.trim();
    myCarColor = document.getElementById('car-select').value;
    
    if (codeInput !== "") {
        socket.emit('joinRoom', { roomCode: codeInput, car: myCarColor });
    } else {
        alert("Entre un code de salon !");
    }
});

// Retours du serveur
socket.on('roomCreated', (data) => {
    currentRoomCode = data.roomCode;
    document.getElementById('room-id-text').innerText = currentRoomCode;
    startGame(data.map, botCount, true);
});

socket.on('initGame', (roomData) => {
    currentRoomCode = roomData.id;
    document.getElementById('room-id-text').innerText = currentRoomCode;
    // Les invités récupèrent la map choisie par l'hôte
    startGame(roomData.map, 0, false); 
});

socket.on('joinError', (msg) => {
    alert(msg);
});

function startGame(mapType, countBots, isHost) {
    document.getElementById('menu').style.display = 'none';
    document.getElementById('game-container').style.display = 'block';
    
    // On lance le moteur 3D (défini dans game.js)
    init3DGame(mapType, countBots, isHost, myCarColor, currentRoomCode, socket);
}
