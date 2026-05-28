let scene, camera, renderer;
let playerCar;
let otherPlayers = {};
let bots = [];
let keys = { w: false, s: false, a: false, d: false };
let currentView = "back"; // "back" ou "pilot"

// Variables physiques basiques
let speed = 0;
const maxSpeed = 1.5;
const acceleration = 0.04;
const friction = 0.02;

function init3DGame(mapType, countBots, isHost, carColor, roomCode, socket) {
    // 1. Initialisation Scène, Moteur et Lumières
    scene = new THREE.Scene();
    scene.background = new THREE.Color(mapType === 'desert' ? 0xdfae74 : 0x333333);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById('game-container').appendChild(renderer.domElement);

    const light = new THREE.DirectionalLight(0xffffff, 1.2);
    light.position.set(10, 20, 10);
    scene.add(light);
    scene.add(new THREE.AmbientLight(0x666666));

    // 2. Création de la piste (Un grand anneau ovale simplifié)
    const trackGeometry = new THREE.RingGeometry(40, 60, 64);
    const trackMaterial = new THREE.MeshStandardMaterial({ color: 0x111111, side: THREE.DoubleSide });
    const track = new THREE.Mesh(trackGeometry, trackMaterial);
    track.rotation.x = Math.PI / 2;
    scene.add(track);

    // 3. Création de notre voiture
    playerCar = createCarModel(carColor);
    playerCar.position.set(0, 0.5, 48); // Position sur la ligne de départ
    scene.add(playerCar);

    // 4. Génération des Bots (uniquement si on est l'hôte)
    if (isHost) {
        for (let i = 0; i < countBots; i++) {
            let botCar = createCarModel("yellow");
            botCar.position.set((i + 1) * 3, 0.5, 45);
            scene.add(botCar);
            bots.push({ mesh: botCar, speed: 0.4 + Math.random() * 0.2, angle: 0 });
        }
    }

    // 5. Écouteurs de touches clavier
    window.addEventListener('keydown', (e) => handleKeys(e, true));
    window.addEventListener('keyup', (e) => handleKeys(e, false));

    // Réseau : Mouvement des autres joueurs
    socket.on('playerMoved', (data) => {
        if (!otherPlayers[data.id]) {
            otherPlayers[data.id] = createCarModel("blue");
            scene.add(otherPlayers[data.id]);
        }
        otherPlayers[data.id].position.set(data.x, 0.5, data.z);
        otherPlayers[data.id].rotation.y = data.r;
    });

    // Boucle d'animation principale
    function animate() {
        requestAnimationFrame(animate);

        // Physique et contrôles de notre voiture
        if (keys.w) speed = Math.min(speed + acceleration, maxSpeed);
        else if (keys.s) speed = Math.max(speed - acceleration, -maxSpeed / 2);
        else {
            if (speed > 0) speed = Math.max(0, speed - friction);
            if (speed < 0) speed = Math.min(0, speed + friction);
        }

        if (keys.a) playerCar.rotation.y += 0.04 * (speed / maxSpeed || 1);
        if (keys.d) playerCar.rotation.y -= 0.04 * (speed / maxSpeed || 1);

        playerCar.translateZ(speed);

        // Envoi de notre position au serveur
        socket.emit('updatePlayer', {
            roomCode: roomCode,
            x: playerCar.position.x,
            z: playerCar.position.z,
            r: playerCar.rotation.y
        });

        // Comportement IA des Bots (Suivi d'un tracé circulaire simple)
        bots.forEach(bot => {
            bot.angle += bot.speed * 0.01;
            bot.mesh.position.x = Math.sin(bot.angle) * (48 + bot.mesh.id % 4);
            bot.mesh.position.z = Math.cos(bot.angle) * (48 + bot.mesh.id % 4);
            bot.mesh.rotation.y = bot.angle + Math.PI / 2;
        });

        // Gestion et placement des Caméras
        updateCameraView();

        renderer.render(scene, camera);
    }
    animate();
}

// Fonction de création graphique d'une voiture (Boîte 3D simplifiée)
function createCarModel(colorHex) {
    const carGroup = new THREE.Group();
    
    // Châssis principal
    const bodyGeom = new THREE.BoxGeometry(2, 0.6, 4);
    const bodyMat = new THREE.MeshStandardMaterial({ color: colorHex === "blue" ? 0x0000ff : (colorHex === "yellow" ? 0xffff00 : 0xff0000) });
    const body = new THREE.Mesh(bodyGeom, bodyMat);
    body.position.y = 0.3;
    carGroup.add(body);

    // Cockpit / Toit
    const cabinGeom = new THREE.BoxGeometry(1.4, 0.6, 1.8);
    const cabinMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const cabin = new THREE.Mesh(cabinGeom, cabinMat);
    cabin.position.set(0, 0.9, -0.2);
    carGroup.add(cabin);

    return carGroup;
}

function handleKeys(e, isPressed) {
    if (e.key.toLowerCase() === 'w' || e.key === 'ArrowUp') keys.w = isPressed;
    if (e.key.toLowerCase() === 's' || e.key === 'ArrowDown') keys.s = isPressed;
    if (e.key.toLowerCase() === 'a' || e.key === 'ArrowLeft') keys.a = isPressed;
    if (e.key.toLowerCase() === 'd' || e.key === 'ArrowRight') keys.d = isPressed;

    // Touche C pour alterner les caméras
    if (e.key.toLowerCase() === 'c' && isPressed) {
        currentView = (currentView === "back") ? "pilot" : "back";
    }
}

function updateCameraView() {
    if (currentView === "back") {
        // Vue derrière la voiture
        const relativeCameraOffset = new THREE.Vector3(0, 3, -8);
        const cameraOffset = relativeCameraOffset.applyMatrix4(playerCar.matrixWorld);
        camera.position.x = cameraOffset.x;
        camera.position.y = cameraOffset.y;
        camera.position.z = cameraOffset.z;
        camera.lookAt(playerCar.position.clone().add(new THREE.Vector3(0, 1, 2)));
    } else {
        // Vue pilote / cockpit (Sur l'avant de la voiture)
        const relativeCameraOffset = new THREE.Vector3(0, 1.1, 0.2);
        const cameraOffset = relativeCameraOffset.applyMatrix4(playerCar.matrixWorld);
        camera.position.x = cameraOffset.x;
        camera.position.y = cameraOffset.y;
        camera.position.z = cameraOffset.z;
        
        // Regarder vers l'avant de la voiture
        const targetOffset = new THREE.Vector3(0, 0.8, 5).applyMatrix4(playerCar.matrixWorld);
        camera.lookAt(targetOffset);
    }
}

// Gérer le redimensionnement de l'écran
window.addEventListener('resize', () => {
    if(camera && renderer) {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }
});
