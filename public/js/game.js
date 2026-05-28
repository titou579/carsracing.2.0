let scene, camera, renderer;
let playerCar;
let otherPlayers = {};
let bots = [];
let keys = { w: false, s: false, a: false, d: false, space: false };
let currentView = "back"; 

// --- PARAMÈTRES ET CARACTÉRISTIQUES DES VOITURES ---
let carSpecs = {
    red:    { maxSpeed: 1.6, accel: 0.04, handling: 0.045, weight: 1.2 },
    blue:   { maxSpeed: 1.8, accel: 0.03, handling: 0.035, weight: 1.0 },
    yellow: { maxSpeed: 1.4, accel: 0.05, handling: 0.050, weight: 1.5 }
};
let mySpec = carSpecs.red;

// --- PHYSIQUE, NITRO ET EFFETS ---
let speed = 0;
const friction = 0.015;
let playerRadius = 1.2; 
let nitroAmount = 100; // Jauge de 0 à 100
let isUsingNitro = false;
let particleSystems = []; // Pour gérer la poussière et la nitro

// --- CONFIGURATION DU CIRCUIT ET MINI-MAP ---
let trackPoints = [];
let barriers = [];
let checkpointAngle = 0;
let currentLap = 0;
const totalLaps = 3;
let raceStarted = false;
let countdownNumber = 3;
let minimapCtx; // Contexte 2D pour la mini-map

function init3DGame(mapType, countBots, isHost, carColor, roomCode, socket) {
    mySpec = carSpecs[carColor] || carSpecs.red;

    // 1. Initialisation Scène, Moteur et Ciel
    scene = new THREE.Scene();
    scene.background = new THREE.Color(mapType === 'desert' ? 0xdfae74 : 0x1e2224);
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

    // 2. Génération du Circuit et des Barrières
    createComplexTrack(mapType);

    // 3. Création du Joueur
    playerCar = createDetailedCar(carColor);
    playerCar.position.set(trackPoints[0].x, 0.4, trackPoints[0].z);
    playerCar.lookAt(trackPoints[1].x, 0.4, trackPoints[1].z);
    scene.add(playerCar);

    // 4. Génération des Bots (Uniquement pour l'Hôte)
    if (isHost) {
        for (let i = 0; i < countBots; i++) {
            let botCar = createDetailedCar("yellow");
            botCar.position.set(trackPoints[0].x + (i + 1) * 2.5, 0.4, trackPoints[0].z);
            scene.add(botCar);
            bots.push({
                mesh: botCar,
                targetPointIndex: 1,
                speed: mySpec.maxSpeed * (0.78 + Math.random() * 0.14),
                radius: 1.2,
                aggressiveness: 0.06
            });
        }
    }

    // 5. Interface HTML (Compte à rebours, Tours, Nitro, Mini-map)
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

    startCountdown();

    // 7. Boucle principale d'animation
    function animate() {
        requestAnimationFrame(animate);

        // Récupération de la vitesse maximale modifiée par la Nitro
        let currentMaxSpeed = mySpec.maxSpeed;
        isUsingNitro = false;

        if (raceStarted) {
            // Gestion de la Nitro (Barre Espace)
            if (keys.space && nitroAmount > 0 && keys.w) {
                currentMaxSpeed = mySpec.maxSpeed * 1.4; // +40% de vitesse max
                speed = Math.min(speed + mySpec.accel * 1.5, currentMaxSpeed);
                nitroAmount -= 0.6; // Consommation
                isUsingNitro = true;
                createParticles(playerCar.position, 0xff4500, 3); // Flammes de pot d'échappement
            } else {
                // La nitro se recharge doucement quand on ne l'utilise pas
                nitroAmount = Math.min(100, nitroAmount + 0.1);
            }
            document.getElementById('nitro-bar').style.width = `${nitroAmount}%`;

            // --- CONTROLES & PHYSIQUE JOUEUR ---
            if (keys.w && !isUsingNitro) speed = Math.min(speed + mySpec.accel, currentMaxSpeed);
            else if (keys.s) speed = Math.max(speed - mySpec.accel, -currentMaxSpeed / 2);
            else if (!isUsingNitro) {
                if (speed > 0) speed = Math.max(0, speed - friction);
                if (speed < 0) speed = Math.min(0, speed + friction);
            }

            // Limitation si on lâche la nitro
            if(!isUsingNitro && speed > mySpec.maxSpeed) speed -= 0.02;

            // Maniabilité accrue avec effet de dérapage visuel
            let turnSpeed = mySpec.handling * (0.4 + (Math.abs(speed) / currentMaxSpeed) * 0.6);
            if (keys.a) {
                playerCar.rotation.y += turnSpeed;
                if(speed > 0.8) createParticles(playerCar.position, 0x555555, 1); // Poussière de pneu
            }
            if (keys.d) {
                playerCar.rotation.y -= turnSpeed;
                if(speed > 0.8) createParticles(playerCar.position, 0x555555, 1);
            }

            playerCar.translateZ(speed);

            // --- IA DES BOTS AGRESSIFS ---
            bots.forEach(bot => {
                let target = trackPoints[bot.targetPointIndex];
                let distToTarget = bot.mesh.position.distanceTo(target);

                if (distToTarget < 8) {
                    bot.targetPointIndex = (bot.targetPointIndex + 1) % trackPoints.length;
                }

                let targetRotation = Math.atan2(target.x - bot.mesh.position.x, target.z - bot.mesh.position.z);
                
                let distToPlayer = bot.mesh.position.distanceTo(playerCar.position);
                if (distToPlayer < 12 && speed > 0) {
                    targetRotation = Math.atan2(playerCar.position.x - bot.mesh.position.x, playerCar.position.z - bot.mesh.position.z);
                }

                let diffR = targetRotation - bot.mesh.rotation.y;
                diffR = Math.atan2(Math.sin(diffR), Math.cos(diffR)); 
                bot.mesh.rotation.y += diffR * bot.aggressiveness;

                bot.mesh.translateZ(bot.speed);

                // Collision Joueur / Bot
                if (distToPlayer < (playerRadius + bot.radius)) {
                    let pushX = playerCar.position.x - bot.mesh.position.x;
                    let pushZ = playerCar.position.z - bot.mesh.position.z;
                    let vector = new THREE.Vector2(pushX, pushZ).normalize().multiplyScalar(0.25);
                    
                    playerCar.position.x += vector.x;
                    playerCar.position.z += vector.y;
                    speed *= -0.3; 
                }
            });

            // --- COLLISION BARRIÈRES ---
            barriers.forEach(barrier => {
                let distToBarrier = playerCar.position.distanceTo(barrier.position);
                if (distToBarrier < (playerRadius + 1.0)) {
                    let pushBack = playerCar.position.clone().sub(barrier.position).normalize().multiplyScalar(0.25);
                    playerCar.position.add(pushBack);
                    speed = -speed * 0.3; 
                }
            });

            // --- CHECKPOINT / TOURS ---
            let distToStart = playerCar.position.distanceTo(trackPoints[0]);
            let distToHalf = playerCar.position.distanceTo(trackPoints[Math.floor(trackPoints.length / 2)]);

            if (distToHalf < 15) checkpointAngle = 1; 
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

        // --- ANIMATION DES PARTICULES (Nitro / Poussière) ---
        updateParticles();

        // --- DYNAMIQUE DES CAMÉRAS & EFFET FOV ---
        updateCameraView(currentMaxSpeed);

        // --- RENDU DE LA MINI-MAP ---
        drawMinimap();

        renderer.render(scene, camera);
    }
    animate();
}

// --- SYSTÈME DE PARTICULES SIMPLE ---
function createParticles(position, colorHex, count) {
    const pGeom = new THREE.BoxGeometry(0.15, 0.15, 0.15);
    const pMat = new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.8 });
    
    for (let i = 0; i < count; i++) {
        const pMesh = new THREE.Mesh(pGeom, pMat);
        pMesh.position.set(
            position.x + (Math.random() - 0.5) * 0.6,
            position.y + (Math.random() - 0.5) * 0.2,
            position.z + (Math.random() - 0.5) * 0.6
        );
        scene.add(pMesh);
        particleSystems.push({
            mesh: pMesh,
            life: 1.0,
            vX: (Math.random() - 0.5) * 0.1,
            vY: Math.random() * 0.05,
            vZ: (Math.random() - 0.5) * 0.1
        });
    }
}

function updateParticles() {
    for (let i = particleSystems.length - 1; i >= 0; i--) {
        let p = particleSystems[i];
        p.mesh.position.x += p.vX;
        p.mesh.position.y += p.vY;
        p.mesh.position.z += p.vZ;
        p.life -= 0.04;
        p.mesh.material.opacity = p.life;

        if (p.life <= 0) {
            scene.remove(p.mesh);
            p.mesh.geometry.dispose();
            p.mesh.material.dispose();
            particleSystems.splice(i, 1);
        }
    }
}

// --- CRÉATION DU CIRCUITS ET BARRIÈRES ---
function createComplexTrack(mapType) {
    const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 70),
        new THREE.Vector3(55, 0, 50),
        new THREE.Vector3(80, 0, 0),
        new THREE.Vector3(55, 0, -55),
        new THREE.Vector3(0, 0, -40),
        new THREE.Vector3(-55, 0, -70),
        new THREE.Vector3(-85, 0, 0),
        new THREE.Vector3(-45, 0, 55)
    ], true);

    trackPoints = curve.getPoints(100);

    const trackGeom = new THREE.TubeGeometry(curve, 100, 7.5, 16, true);
    const trackMat = new THREE.MeshStandardMaterial({ 
        color: mapType === 'desert' ? 0x544338 : 0x242424, 
        roughness: 0.85 
    });
    const trackMesh = new THREE.Mesh(trackGeom, trackMat);
    trackMesh.position.y = -0.2; 
    scene.add(trackMesh);

    // Ligne de départ
    const startLine = new THREE.Mesh(new THREE.BoxGeometry(15, 0.05, 0.6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    startLine.position.set(trackPoints[0].x, 0.01, trackPoints[0].z);
    scene.add(startLine);

    // Placement intelligent des barrières
    for (let i = 0; i < trackPoints.length; i += 2) {
        let p = trackPoints[i];
        let nextP = trackPoints[(i + 1) % trackPoints.length];
        
        let dir = new THREE.Vector3().subVectors(nextP, p).normalize();
        let normal = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(8.0);

        let barrierMat = new THREE.MeshStandardMaterial({ color: i % 4 === 0 ? 0xcc2222 : 0xeeeeee }); 
        let barrierGeom = new THREE.BoxGeometry(0.4, 1.0, 2.8);

        let bExt = new THREE.Mesh(barrierGeom, barrierMat);
        bExt.position.set(p.x + normal.x, 0.5, p.z + normal.z);
        bExt.lookAt(nextP.x + normal.x, 0.5, nextP.z + normal.z);
        scene.add(bExt);
        barriers.push(bExt);

        let bInt = new THREE.Mesh(barrierGeom, barrierMat);
        bInt.position.set(p.x - normal.x, 0.5, p.z - normal.z);
        bInt.lookAt(nextP.x - normal.x, 0.5, nextP.z - normal.z);
        scene.add(bInt);
        barriers.push(bInt);
    }
}

// --- DESIGN DES VOITURES ---
function createDetailedCar(colorHex) {
    const carGroup = new THREE.Group();
    const c = colorHex === "blue" ? 0x0066ff : (colorHex === "yellow" ? 0xffbb00 : 0xff1100);

    const bodyMat = new THREE.MeshStandardMaterial({ color: c, roughness: 0.2, metalness: 0.6 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.4, 3.6), bodyMat);
    body.position.y = 0.2;
    carGroup.add(body);

    const glassMat = new THREE.MeshStandardMaterial({ color: 0x0f0f0f, roughness: 0.1 });
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.45, 1.4), glassMat);
    cabin.position.set(0, 0.55, -0.2);
    carGroup.add(cabin);

    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.1, 0.5), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    wing.position.set(0, 0.7, -1.6);
    carGroup.add(wing);

    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8 });
    const wheelGeom = new THREE.CylinderGeometry(0.35, 0.35, 0.4, 16);
    wheelGeom.rotateZ(Math.PI / 2);

    const positions = [[-0.9, 0.15, 1.1], [0.9, 0.15, 1.1], [-0.9, 0.15, -1.1], [0.9, 0.15, -1.1]];
    positions.forEach(pos => {
        let wheel = new THREE.Mesh(wheelGeom, wheelMat);
        wheel.position.set(pos[0], pos[1], pos[2]);
        carGroup.add(wheel);
    });

    return carGroup;
}

// --- INTERFACE DE JEU (AVEC NITRO ET MINI-MAP) ---
function setupInGameUI() {
    const overlay = document.getElementById('ui-overlay');
    
    if(!document.getElementById('lap-container')) {
        // Compteur de tours
        const lapDiv = document.createElement('div');
        lapDiv.id = "lap-container";
        lapDiv.innerHTML = `Tour : <span id="lap-count">0/${totalLaps}</span>`;
        lapDiv.style.cssText = "background:rgba(0,0,0,0.8); padding:10px 15px; border-radius:5px; font-size:16px; margin-top:5px; border-left:4px solid #fff; font-weight:bold;";
        overlay.appendChild(lapDiv);

        // Barre de Nitro HTML
        const nitroDiv = document.createElement('div');
        nitroDiv.style.cssText = "background:rgba(0,0,0,0.8); padding:10px; border-radius:5px; font-size:14px; margin-top:5px; border-left:4px solid #ff4500; width: 180px;";
        nitroDiv.innerHTML = `<div style="margin-bottom:3px; font-weight:bold; color:#ff4500;">BOOST (ESPACE)</div>
                              <div style="background:#333; width:100%; height:12px; border-radius:3px; overflow:hidden;">
                                  <div id="nitro-bar" style="background:linear-gradient(90deg, #ff4500, #ff8c00); width:100%; height:100%; transition: width 0.1s;"></div>
                              </div>`;
        overlay.appendChild(nitroDiv);

        // Zone Info commandes
        const cmdInfo = document.createElement('div');
        cmdInfo.style.cssText = "background:rgba(0,0,0,0.8); padding:8px 12px; border-radius:5px; font-size:12px; margin-top:5px; color:#aaa;";
        cmdInfo.innerHTML = "Contrôles : <strong>Z,Q,S,D</strong> ou <strong>Flèches</strong>";
        overlay.appendChild(cmdInfo);

        // Création du Canvas pour la Mini-map (en haut à droite de l'écran)
        const minimapCanvas = document.createElement('canvas');
        minimapCanvas.id = "minimap";
        minimapCanvas.width = 150;
        minimapCanvas.height = 150;
        minimapCanvas.style.cssText = "position:absolute; top:10px; right:10px; background:rgba(0,0,0,0.75); border:2px solid #444; border-radius:10px; z-index:10;";
        document.body.appendChild(minimapCanvas);
        minimapCtx = minimapCanvas.getContext('2d');

        // Div pour le grand compte à rebours
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

// --- DESSIN DE LA MINI-MAP CANVAS ---
function drawMinimap() {
    if (!minimapCtx) return;
    
    minimapCtx.clearRect(0, 0, 150, 150);
    
    // Centrage et échelle automatique
    const center = 75;
    const scale = 0.65; // Ajustement pour faire rentrer le circuit à l'écran

    // 1. Dessiner le tracé du circuit en gris
    minimapCtx.beginPath();
    minimapCtx.strokeStyle = "#555555";
    minimapCtx.lineWidth = 6;
    trackPoints.forEach((pt, idx) => {
        let x = center + pt.x * scale;
        let z = center + pt.z * scale;
        if (idx === 0) minimapCtx.moveTo(x, z);
        else minimapCtx.lineTo(x, z);
    });
    minimapCtx.closePath();
    minimapCtx.stroke();

    // 2. Dessiner les Bots (Points Jaunes)
    bots.forEach(bot => {
        minimapCtx.beginPath();
        minimapCtx.fillStyle = "#ffcc00";
        minimapCtx.arc(center + bot.mesh.position.x * scale, center + bot.mesh.position.z * scale, 3, 0, Math.PI * 2);
        minimapCtx.fill();
    });

    // 3. Dessiner le Joueur (Point Rouge Principal)
    minimapCtx.beginPath();
    minimapCtx.fillStyle = "#ff1100";
    minimapCtx.arc(center + playerCar.position.x * scale, center + playerCar.position.z * scale, 4.5, 0, Math.PI * 2);
    minimapCtx.fill();
}

// --- EFFET DE RECUL ET FOV DYNAMIQUE ---
function updateCameraView(currentMaxSpeed) {
    // Calcul dynamique du FOV basé sur la vitesse (Effet de distorsion de vitesse)
    let speedRatio = Math.abs(speed) / currentMaxSpeed;
    let targetFOV = 60 + (speedRatio * 18); // Le FOV passe de 60 à 78 à plein régime
    if (camera.fov !== targetFOV) {
        camera.fov = THREE.MathUtils.lerp(camera.fov, targetFOV, 0.1);
        camera.updateProjectionMatrix();
    }

    if (currentView === "back") {
        // Vue arrière : Lerp fluide
        const relativeCameraOffset = new THREE.Vector3(0, 2.5, -7 - (speedRatio * 1.5)); // Recule un peu plus si on va vite
        const cameraOffset = relativeCameraOffset.applyMatrix4(playerCar.matrixWorld);
        camera.position.lerp(cameraOffset, 0.15); 
        camera.lookAt(playerCar.position.clone().add(new THREE.Vector3(0, 0.8, 2)));
    } else {
        // Vue à la première personne : Posée net sur le capot avant
        const relativeCameraOffset = new THREE.Vector3(0, 0.65, 0.8);
        const cameraOffset = relativeCameraOffset.applyMatrix4(playerCar.matrixWorld);
        camera.position.copy(cameraOffset);
        
        const targetOffset = new THREE.Vector3(0, 0.5, 10).applyMatrix4(playerCar.matrixWorld);
        camera.lookAt(targetOffset);
    }
}

function handleKeys(e, isPressed) {
    if (e.key.toLowerCase() === 'w' || e.key === 'ArrowUp') keys.w = isPressed;
    if (e.key.toLowerCase() === 's' || e.key === 'ArrowDown') keys.s = isPressed;
    if (e.key.toLowerCase() === 'a' || e.key === 'ArrowLeft') keys.a = isPressed;
    if (e.key.toLowerCase() === 'd' || e.key === 'ArrowRight') keys.d = isPressed;
    if (e.key === ' ') keys.space = isPressed; // Barre Espace pour la nitro

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
