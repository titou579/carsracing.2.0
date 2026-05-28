let scene, camera, renderer;
let playerCar;
let otherPlayers = {};
let bots = [];
let keys = { w: false, s: false, a: false, d: false };
let currentView = "back"; 

// --- PARAMÈTRES ET CARACTÉRISTIQUES DES VOITURES ---
let carSpecs = {
    red:    { maxSpeed: 1.6, accel: 0.04, handling: 0.045, weight: 1.2 },
    blue:   { maxSpeed: 1.8, accel: 0.03, handling: 0.035, weight: 1.0 },
    yellow: { maxSpeed: 1.4, accel: 0.05, handling: 0.050, weight: 1.5 }
};
let mySpec = carSpecs.red; // Par défaut

// --- PHYSIQUE ET ÉTAT DU JOUEUR ---
let speed = 0;
const friction = 0.015;
let playerRadius = 1.2; // Rayon de la hitbox circulaire

// --- CONFIGURATION DU CIRCUIT ---
let trackPoints = [];
let barriers = [];
let checkpointAngle = 0;
let currentLap = 0;
const totalLaps = 3;
let raceStarted = false;
let countdownNumber = 3;

function init3DGame(mapType, countBots, isHost, carColor, roomCode, socket) {
    mySpec = carSpecs[carColor] || carSpecs.red;

    // 1. Initialisation Scène, Moteur et Ciel
    scene = new THREE.Scene();
    scene.background = new THREE.Color(mapType === 'desert' ? 0xdfae74 : 0x222629);
    scene.fog = new THREE.FogExp2(scene.background, 0.005);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById('game-container').appendChild(renderer.domElement);

    // Lumières réalistes
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.4);
    dirLight.position.set(20, 40, 20);
    scene.add(dirLight);
    scene.add(new THREE.AmbientLight(0x555555));

    // 2. Génération de la Map Déformée (Circuit en Forme de Haricot / Patate)
    createComplexTrack(mapType);

    // 3. Création du Joueur
    playerCar = createDetailedCar(carColor);
    // On positionne le joueur au premier point du circuit (Ligne de départ)
    playerCar.position.set(trackPoints[0].x, 0.4, trackPoints[0].z);
    // Oriente la voiture vers le point suivant
    playerCar.lookAt(trackPoints[1].x, 0.4, trackPoints[1].z);
    scene.add(playerCar);

    // 4. Génération des Bots (Uniquement pour l'Hôte)
    if (isHost) {
        for (let i = 0; i < countBots; i++) {
            let botCar = createDetailedCar("yellow");
            // Décale un peu les bots sur la grille de départ
            botCar.position.set(trackPoints[0].x + (i + 1) * 2.5, 0.4, trackPoints[0].z);
            scene.add(botCar);
            bots.push({
                mesh: botCar,
                targetPointIndex: 1,
                speed: mySpec.maxSpeed * (0.8 + Math.random() * 0.15),
                radius: 1.2,
                aggressiveness: 0.05
            });
        }
    }

    // 5. Interface HTML pour le compte à rebours et les tours
    setupInGameUI();

    // 6. Écouteurs d'entrées
    window.addEventListener('keydown', (e) => handleKeys(e, true));
    window.addEventListener('keyup', (e) => handleKeys(e, false));

    // Réseau : Gestion des adversaires en ligne
    socket.on('playerMoved', (data) => {
        if (!otherPlayers[data.id]) {
            otherPlayers[data.id] = createDetailedCar(data.color || "blue");
            scene.add(otherPlayers[data.id]);
        }
        otherPlayers[data.id].position.set(data.x, 0.4, data.z);
        otherPlayers[data.id].rotation.y = data.r;
    });

    // Lancement du Compte à rebours
    startCountdown();

    // 7. Boucle principale d'animation
    function animate() {
        requestAnimationFrame(animate);

        if (raceStarted) {
            // --- CONTROLES & PHYSIQUE JOUEUR ---
            if (keys.w) speed = Math.min(speed + mySpec.accel, mySpec.maxSpeed);
            else if (keys.s) speed = Math.max(speed - mySpec.accel, -mySpec.maxSpeed / 2);
            else {
                if (speed > 0) speed = Math.max(0, speed - friction);
                if (speed < 0) speed = Math.min(0, speed + friction);
            }

            // Maniabilité accrue : On tourne plus facilement si on roule vite, et dérapage léger simulé
            let turnSpeed = mySpec.handling * (0.5 + (Math.abs(speed) / mySpec.maxSpeed) * 0.5);
            if (keys.a) playerCar.rotation.y += turnSpeed;
            if (keys.d) playerCar.rotation.y -= turnSpeed;

            playerCar.translateZ(speed);

            // --- IA DES BOTS AGRESSIFS ---
            bots.forEach(bot => {
                let target = trackPoints[bot.targetPointIndex];
                let distToTarget = bot.mesh.position.distanceTo(target);

                if (distToTarget < 8) {
                    bot.targetPointIndex = (bot.targetPointIndex + 1) % trackPoints.length;
                }

                // Rotation fluide vers le point suivant
                let targetRotation = Math.atan2(target.x - bot.mesh.position.x, target.z - bot.mesh.position.z);
                
                // --- COMPORTEMENT AGRESSIF ---
                // Si le joueur est très proche, le bot essaie de bloquer sa trajectoire
                let distToPlayer = bot.mesh.position.distanceTo(playerCar.position);
                if (distToPlayer < 12 && speed > 0) {
                    // Le bot modifie légèrement sa cible vers la position du joueur pour s'imposer
                    targetRotation = Math.atan2(playerCar.position.x - bot.mesh.position.x, playerCar.position.z - bot.mesh.position.z);
                }

                // Ajustement de la trajectoire du bot
                let diffR = targetRotation - bot.mesh.rotation.y;
                diffR = Math.atan2(Math.sin(diffR), Math.cos(diffR)); // Normalisation
                bot.mesh.rotation.y += diffR * bot.aggressiveness;

                bot.mesh.translateZ(bot.speed);

                // --- COLLISION JOUEUR CONTRE BOT ---
                if (distToPlayer < (playerRadius + bot.radius)) {
                    // Calcul du vecteur de recul mécanique (poussée)
                    let pushX = playerCar.position.x - bot.mesh.position.x;
                    let pushZ = playerCar.position.z - bot.mesh.position.z;
                    let vector = new THREE.Vector2(pushX, pushZ).normalize().multiplyScalar(0.2);
                    
                    playerCar.position.x += vector.x;
                    playerCar.position.z += vector.y;
                    speed *= -0.4; // Perte de vitesse brutale lors du choc
                }
            });

            // --- COLLISION AVEC LES BARRIÈRES DE ROUTE ---
            barriers.forEach(barrier => {
                let distToBarrier = playerCar.position.distanceTo(barrier.position);
                if (distToBarrier < (playerRadius + 1.0)) {
                    let pushBack = playerCar.position.clone().sub(barrier.position).normalize().multiplyScalar(0.25);
                    playerCar.position.add(pushBack);
                    speed = -speed * 0.3; // Rebond contre la glissière de sécurité
                }
            });

            // --- SYSTÈME DE COMPTEUR DE TOURS (CHECKPOINT) ---
            let distToStart = playerCar.position.distanceTo(trackPoints[0]);
            let distToHalf = playerCar.position.distanceTo(trackPoints[Math.floor(trackPoints.length / 2)]);

            if (distToHalf < 15) checkpointAngle = 1; // Le joueur a passé la moitié du circuit
            if (distToStart < 12 && checkpointAngle === 1) {
                checkpointAngle = 0;
                currentLap++;
                document.getElementById('lap-count').innerText = `${currentLap}/${totalLaps}`;
                if (currentLap >= totalLaps) {
                    alert("🏁 Course Terminée ! Félicitations !");
                    raceStarted = false;
                }
            }

            // Envoi réseau
            socket.emit('updatePlayer', {
                roomCode: roomCode,
                x: playerCar.position.x,
                z: playerCar.position.z,
                r: playerCar.rotation.y,
                color: carColor
            });
        }

        // Caméras dynamiques
        updateCameraView();

        renderer.render(scene, camera);
    }
    animate();
}

// --- CRÉATION DE LA MAP DÉFORMÉE ET DES BARRIÈRES ---
function createComplexTrack(mapType) {
    // Définition de la forme du circuit (Ligne centrale asymétrique)
    const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 60),
        new THREE.Vector3(45, 0, 45),
        new THREE.Vector3(70, 0, 0),
        new THREE.Vector3(50, 0, -45),
        new THREE.Vector3(0, 0, -35),
        new THREE.Vector3(-45, 0, -60),
        new THREE.Vector3(-75, 0, 0),
        new THREE.Vector3(-40, 0, 45)
    ], true);

    trackPoints = curve.getPoints(100);

    // Visuel de la route goudronnée
    const trackGeom = new THREE.TubeGeometry(curve, 100, 7, 16, true);
    const trackMat = new THREE.MeshStandardMaterial({ 
        color: mapType === 'desert' ? 0x4a3b32 : 0x2a2a2a, 
        roughness: 0.8 
    });
    const trackMesh = new THREE.Mesh(trackGeom, trackMat);
    trackMesh.position.y = -0.2; // Légèrement enfoncé
    scene.add(trackMesh);

    // Ajout d'une ligne de départ blanche au sol
    const startLineGeom = new THREE.BoxGeometry(14, 0.05, 0.5);
    const startLineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const startLine = new THREE.Mesh(startLineGeom, startLineMat);
    startLine.position.set(trackPoints[0].x, 0.01, trackPoints[0].z);
    scene.add(startLine);

    // Placement des barrières (Intérieur et Extérieur de la piste)
    for (let i = 0; i < trackPoints.length; i += 2) {
        let p = trackPoints[i];
        let nextP = trackPoints[(i + 1) % trackPoints.length];
        
        // Calcul du vecteur normal pour écarter les barrières à gauche et à droite de la route
        let dir = new THREE.Vector3().subVectors(nextP, p).normalize();
        let normal = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(7.5);

        let barrierMat = new THREE.MeshStandardMaterial({ color: 0xdd2222 }); // Rouge et blanc
        let barrierGeom = new THREE.BoxGeometry(0.5, 1.2, 2.5);

        // Barrière Extérieure
        let bExt = new THREE.Mesh(barrierGeom, barrierMat);
        bExt.position.set(p.x + normal.x, 0.6, p.z + normal.z);
        bExt.lookAt(nextP.x + normal.x, 0.6, nextP.z + normal.z);
        scene.add(bExt);
        barriers.push(bExt);

        // Barrière Intérieure
        let bInt = new THREE.Mesh(barrierGeom, barrierMat);
        bInt.position.set(p.x - normal.x, 0.6, p.z - normal.z);
        bInt.lookAt(nextP.x - normal.x, 0.6, nextP.z - normal.z);
        scene.add(bInt);
        barriers.push(bInt);
    }
}

// --- DESIGN DES VOITURES SOUCI DE RÉALISME ---
function createDetailedCar(colorHex) {
    const carGroup = new THREE.Group();
    const c = colorHex === "blue" ? 0x0077ff : (colorHex === "yellow" ? 0xffcc00 : 0xff2200);

    // Carrosserie profilée aérodynamique
    const bodyMat = new THREE.MeshStandardMaterial({ color: c, roughness: 0.2, metalness: 0.5 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.4, 3.6), bodyMat);
    body.position.y = 0.2;
    carGroup.add(body);

    // Habitacle (Pare-brise en verre sombre)
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.1 });
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.45, 1.4), glassMat);
    cabin.position.set(0, 0.55, -0.2);
    carGroup.add(cabin);

    // Aileron Arrière (Style Course)
    const wingMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.1, 0.5), wingMat);
    wing.position.set(0, 0.7, -1.6);
    carGroup.add(wing);

    // Les 4 Roues (Cylindres texturés)
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 });
    const wheelGeom = new THREE.CylinderGeometry(0.35, 0.35, 0.4, 16);
    wheelGeom.rotateZ(Math.PI / 2);

    const positions = [
        [-0.9, 0.15, 1.1],  // Avant Gauche
        [0.9, 0.15, 1.1],   // Avant Droite
        [-0.9, 0.15, -1.1], // Arrière Gauche
        [0.9, 0.15, -1.1]   // Arrière Droite
    ];

    positions.forEach(pos => {
        let wheel = new THREE.Mesh(wheelGeom, wheelMat);
        wheel.position.set(pos[0], pos[1], pos[2]);
        carGroup.add(wheel);
    });

    return carGroup;
}

// --- COMPTE À REBOURS ET UI ---
function setupInGameUI() {
    const overlay = document.getElementById('ui-overlay');
    // On rajoute dynamiquement le compteur de tours s'il n'existe pas
    if(!document.getElementById('lap-container')) {
        const lapDiv = document.createElement('div');
        lapDiv.id = "lap-container";
        lapDiv.innerHTML = `Tour : <span id="lap-count">0/${totalLaps}</span>`;
        lapDiv.style.cssText = "background:rgba(0,0,0,0.7); padding:10px; border-radius:5px; font-size:16px; margin-top:5px; border-left:4px solid #fff;";
        overlay.appendChild(lapDiv);

        const countdownDiv = document.createElement('div');
        countdownDiv.id = "countdown";
        countdownDiv.style.cssText = "position:absolute; top:40%; left:50%; transform:translate(-50%,-50%); font-size:90px; font-weight:bold; color:#ff4500; text-shadow:3px 3px 10px #000; z-index:20;";
        document.body.appendChild(countdownDiv);
    }
}

function startCountdown() {
    const cDiv = document.getElementById('countdown');
    raceStarted = false;
    countdownNumber = 3;
    cDiv.innerText = countdownNumber;

    let interval = setInterval(() => {
        countdownNumber--;
        if (countdownNumber === 0) {
            cDiv.innerText = "START !";
            raceStarted = true;
        } else if (countdownNumber < 0) {
            clearInterval(interval);
            cDiv.innerText = "";
        } else {
            cDiv.innerText = countdownNumber;
        }
    }, 1000);
}

// --- RE-CALIBRAGE COMPLET DES VUES CAMÉRA ---
function updateCameraView() {
    if (currentView === "back") {
        // Vue arrière : Suivi fluide légèrement surélevé
        const relativeCameraOffset = new THREE.Vector3(0, 2.5, -7);
        const cameraOffset = relativeCameraOffset.applyMatrix4(playerCar.matrixWorld);
        camera.position.lerp(cameraOffset, 0.2); // Effet d'amorti fluide
        camera.lookAt(playerCar.position.clone().add(new THREE.Vector3(0, 0.8, 2)));
    } else {
        // Vue à la première personne (Placée exactement sur le capot avant pour éviter l'effet boîte noire)
        const relativeCameraOffset = new THREE.Vector3(0, 0.65, 0.8);
        const cameraOffset = relativeCameraOffset.applyMatrix4(playerCar.matrixWorld);
        camera.position.copy(cameraOffset);
        
        // Regard orienté loin devant la route
        const targetOffset = new THREE.Vector3(0, 0.5, 10).applyMatrix4(playerCar.matrixWorld);
        camera.lookAt(targetOffset);
    }
}

function handleKeys(e, isPressed) {
    if (e.key.toLowerCase() === 'w' || e.key === 'ArrowUp') keys.w = isPressed;
    if (e.key.toLowerCase() === 's' || e.key === 'ArrowDown') keys.s = isPressed;
    if (e.key.toLowerCase() === 'a' || e.key === 'ArrowLeft') keys.a = isPressed;
    if (e.key.toLowerCase() === 'd' || e.key === 'ArrowRight') keys.d = isPressed;

    if (e.key.toLowerCase() === 'c' && isPressed) {
        currentView = (currentView === "back") ? "pilot" : "back";
    }
}

window.addEventListener('resize', () => {
    if(camera && renderer) {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }
});
