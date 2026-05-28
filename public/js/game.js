let scene, camera, renderer;
let playerCar;
let otherPlayers = {};
let bots = [];
let keys = { w: false, s: false, a: false, d: false, space: false };
let currentView = "back"; 

// --- SENSATIONS DE CONDUITE CORRIGÉES ET ÉQUILIBRÉES ---
let carSpecs = {
    red:    { maxSpeed: 0.75, accel: 0.015, handling: 0.035, braking: 0.04 },
    blue:   { maxSpeed: 0.85, accel: 0.012, handling: 0.028, braking: 0.03 },
    yellow: { maxSpeed: 0.68, accel: 0.020, handling: 0.040, braking: 0.05 }
};
let mySpec = carSpecs.red;

let speed = 0;
const friction = 0.008; // Ralentissement naturel plus prononcé
let playerRadius = 1.2; 
let nitroAmount = 100; 
let isUsingNitro = false;
let particleSystems = []; 

// --- REPERES DU CIRCUIT ---
let trackPoints = [];
let barriers = [];
let checkpointAngle = 0;
let currentLap = 0;
const totalLaps = 3;
let raceStarted = false;
let countdownNumber = 3;
let minimapCtx; 

function init3DGame(mapType, countBots, isHost, carColor, roomCode, socket) {
    mySpec = carSpecs[carColor] || carSpecs.red;

    // 1. Initialisation Scène avec Brouillard pour la profondeur
    scene = new THREE.Scene();
    const bgColor = mapType === 'desert' ? 0xe0b080 : 0x222629;
    scene.background = new THREE.Color(bgColor);
    scene.fog = new THREE.FogExp2(bgColor, 0.007);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById('game-container').appendChild(renderer.domElement);

    // Lumières retravaillées pour le relief du décor
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.4);
    dirLight.position.set(40, 80, 40);
    scene.add(dirLight);
    scene.add(new THREE.AmbientLight(0x666666));

    // 2. Génération du décor d'environnement, du circuit et de l'arche de départ
    createEnvironment(mapType);
    createComplexTrack(mapType);

    // 3. Positionnement initial et orientation parfaite du joueur
    playerCar = createDetailedCar(carColor);
    playerCar.position.set(trackPoints[0].x, 0.4, trackPoints[0].z);
    playerCar.lookAt(trackPoints[1].x, 0.4, trackPoints[1].z);
    scene.add(playerCar);

    // 4. Génération des Bots avec IA stabilisée (Uniquement pour l'Hôte)
    if (isHost) {
        for (let i = 0; i < countBots; i++) {
            let botCar = createDetailedCar("yellow");
            // Grille de départ ordonnée derrière le joueur
            let startNode = trackPoints[0];
            botCar.position.set(startNode.x + (i + 1) * 2.2, 0.4, startNode.z - 4);
            botCar.lookAt(trackPoints[1].x, 0.4, trackPoints[1].z);
            scene.add(botCar);
            bots.push({
                mesh: botCar,
                targetPointIndex: 1,
                // Vitesse proportionnelle pour rester compétitif mais contrôlable
                speed: mySpec.maxSpeed * (0.8 + Math.random() * 0.12),
                radius: 1.2,
                aggressiveness: 0.04
            });
        }
    }

    setupInGameUI();

    // Écouteurs de commandes
    window.addEventListener('keydown', (e) => handleKeys(e, true));
    window.addEventListener('keyup', (e) => handleKeys(e, false));

    // Synchronisation réseau des adversaires
    socket.on('playerMoved', (data) => {
        if (!otherPlayers[data.id]) {
            otherPlayers[data.id] = createDetailedCar(data.color || "blue");
            scene.add(otherPlayers[data.id]);
        }
        otherPlayers[data.id].position.set(data.x, 0.4, data.z);
        otherPlayers[data.id].rotation.y = data.r;
    });

    startCountdown();

    // 5. Boucle principale de rendu
    function animate() {
        requestAnimationFrame(animate);

        let currentMaxSpeed = mySpec.maxSpeed;
        isUsingNitro = false;

        if (raceStarted) {
            // Gestion de la Nitro (+30% de boost max)
            if (keys.space && nitroAmount > 0 && keys.w) {
                currentMaxSpeed = mySpec.maxSpeed * 1.3;
                speed = Math.min(speed + mySpec.accel * 1.2, currentMaxSpeed);
                nitroAmount -= 0.8;
                isUsingNitro = true;
                createParticles(playerCar.position, 0xff5500, 2); 
            } else {
                nitroAmount = Math.min(100, nitroAmount + 0.12);
            }
            document.getElementById('nitro-bar').style.width = `${nitroAmount}%`;

            // --- PHYSIQUE ET CONDUITE CORRIGÉE ---
            if (keys.w && !isUsingNitro) {
                speed = Math.min(speed + mySpec.accel, currentMaxSpeed);
            } else if (keys.s) {
                // Vrai système de freinage lourd/marche arrière
                if (speed > 0) speed = Math.max(0, speed - mySpec.braking);
                else speed = Math.max(-currentMaxSpeed / 2, speed - mySpec.accel);
            } else if (!isUsingNitro) {
                // Décélération naturelle au point mort
                if (speed > 0) speed = Math.max(0, speed - friction);
                if (speed < 0) speed = Math.min(0, speed + friction);
            }

            if(!isUsingNitro && speed > mySpec.maxSpeed) speed -= 0.01;

            // --- TOUCHES GAUCHE/DROITE INVERSÉES ICI (CORRIGÉ) ---
            // On ajuste la vitesse de rotation selon l'allure pour éviter les têtes-à-queue
            let turnSpeed = mySpec.handling * (0.3 + (Math.abs(speed) / currentMaxSpeed) * 0.7);
            if (keys.a) {
                playerCar.rotation.y += turnSpeed; // Tourne à gauche
                if(speed > 0.3) createParticles(playerCar.position, 0x666666, 1);
            }
            if (keys.d) {
                playerCar.rotation.y -= turnSpeed; // Tourne à droite
                if(speed > 0.3) createParticles(playerCar.position, 0x666666, 1);
            }

            playerCar.translateZ(speed);

            // --- IA STABILISÉE POUR LES BOTS ---
            bots.forEach(bot => {
                let target = trackPoints[bot.targetPointIndex];
                let distToTarget = bot.mesh.position.distanceTo(target);

                // Portée de détection accrue (18) pour empêcher le bot de rater ses virages et tourner en rond
                if (distToTarget < 18) {
                    bot.targetPointIndex = (bot.targetPointIndex + 1) % trackPoints.length;
                }

                let targetRotation = Math.atan2(target.x - bot.mesh.position.x, target.z - bot.mesh.position.z);
                
                // Agression ciblée et adoucie
                let distToPlayer = bot.mesh.position.distanceTo(playerCar.position);
                if (distToPlayer < 10 && speed > 0) {
                    targetRotation = Math.atan2(playerCar.position.x - bot.mesh.position.x, playerCar.position.z - bot.mesh.position.z);
                }

                let diffR = targetRotation - bot.mesh.rotation.y;
                diffR = Math.atan2(Math.sin(diffR), Math.cos(diffR)); 
                bot.mesh.rotation.y += diffR * bot.aggressiveness;

                bot.mesh.translateZ(bot.speed);

                // Collision physique solide entre Joueur et Bot
                if (distToPlayer < (playerRadius + bot.radius)) {
                    let pushX = playerCar.position.x - bot.mesh.position.x;
                    let pushZ = playerCar.position.z - bot.mesh.position.z;
                    let vector = new THREE.Vector2(pushX, pushZ).normalize().multiplyScalar(0.18);
                    
                    playerCar.position.x += vector.x;
                    playerCar.position.z += vector.y;
                    speed = -speed * 0.2; 
                }
            });

            // --- COLLISIONS AVEC LES GLISSIÈRES DE SECURITÉ ---
            barriers.forEach(barrier => {
                let distToBarrier = playerCar.position.distanceTo(barrier.position);
                if (distToBarrier < (playerRadius + 0.9)) {
                    let pushBack = playerCar.position.clone().sub(barrier.position).normalize().multiplyScalar(0.2);
                    playerCar.position.add(pushBack);
                    speed = -speed * 0.25; // Stop net et rebond léger au lieu de traverser ou s'envoler
                }
            });

            // --- TOURS / CHECKPOINT ---
            let distToStart = playerCar.position.distanceTo(trackPoints[0]);
            let distToHalf = playerCar.position.distanceTo(trackPoints[Math.floor(trackPoints.length / 2)]);

            if (distToHalf < 20) checkpointAngle = 1; 
            if (distToStart < 15 && checkpointAngle === 1) {
                checkpointAngle = 0;
                currentLap++;
                document.getElementById('lap-count').innerText = `${currentLap}/${totalLaps}`;
                if (currentLap >= totalLaps) {
                    alert("🏁 Course Terminée ! Bravo !");
                    raceStarted = false;
                }
            }

            // Envoi réseau des coordonnées
            socket.emit('updatePlayer', {
                roomCode: roomCode,
                x: playerCar.position.x,
                z: playerCar.position.z,
                r: playerCar.rotation.y,
                color: carColor
            });
        }

        updateParticles();
        updateCameraView(currentMaxSpeed);
        drawMinimap();

        renderer.render(scene, camera);
    }
    animate();
}

// --- CRÉATION DU DÉCOR EXTÉRIEUR (DÉCORT) ---
function createEnvironment(mapType) {
    // Un immense sol texturé sous tout le circuit pour ne plus être dans le vide vide
    const floorGeom = new THREE.PlaneGeometry(1000, 1000);
    const floorMat = new THREE.MeshStandardMaterial({ 
        color: mapType === 'desert' ? 0xd29d68 : 0x2b5329, // Sable ou Herbe verte sombre
        roughness: 0.9
    });
    const floor = new THREE.Mesh(floorGeom, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.1;
    scene.add(floor);

    // Ajout de quelques rochers/obstacles décoratifs en dehors de la piste pour habiller l'espace
    const rockGeom = new THREE.DodecahedronGeometry(3, 1);
    const rockMat = new THREE.MeshStandardMaterial({ color: mapType === 'desert' ? 0x96694c : 0x555555, roughness: 0.9 });
    
    for (let i = 0; i < 25; i++) {
        let rock = new THREE.Mesh(rockGeom, rockMat);
        let angle = Math.random() * Math.PI * 2;
        let radius = 100 + Math.random() * 80;
        rock.position.set(Math.sin(angle) * radius, 1, Math.cos(angle) * radius);
        rock.scale.set(1 + Math.random()*2, 1 + Math.random()*3, 1 + Math.random()*2);
        scene.add(rock);
    }
}

// --- TRACÉ ET CONSTRUCTION DU CIRCUIT ET DE L'ARCHE DE DÉPART ---
function createComplexTrack(mapType) {
    const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 80),
        new THREE.Vector3(65, 0, 55),
        new THREE.Vector3(95, 0, 0),
        new THREE.Vector3(65, 0, -65),
        new THREE.Vector3(0, 0, -50),
        new THREE.Vector3(-65, 0, -80),
        new THREE.Vector3(-100, 0, 0),
        new THREE.Vector3(-55, 0, 65)
    ], true);

    trackPoints = curve.getPoints(100);

    const trackGeom = new THREE.TubeGeometry(curve, 100, 8, 16, true);
    const trackMat = new THREE.MeshStandardMaterial({ 
        color: 0x222222, 
        roughness: 0.85 
    });
    const trackMesh = new THREE.Mesh(trackGeom, trackMat);
    trackMesh.position.y = -0.2; 
    scene.add(trackMesh);

    // LIGNES DE DÉPART/ARRIVÉE EN DAMIER AU SOL
    const startLine = new THREE.Mesh(new THREE.BoxGeometry(16, 0.05, 1.2), new THREE.MeshBasicMaterial({ color: 0xeeeeee }));
    startLine.position.set(trackPoints[0].x, 0.01, trackPoints[0].z);
    startLine.lookAt(trackPoints[1].x, 0.01, trackPoints[1].z);
    scene.add(startLine);

    // GROSSE ARCHE 3D DE DÉPART AU-DESSUS DE LA PISTE
    const archGroup = new THREE.Group();
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.6 });
    const topMat = new THREE.MeshStandardMaterial({ color: 0xcc2222 });

    const leftPillar = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 8), pillarMat);
    leftPillar.position.set(-8.5, 4, 0);
    const rightPillar = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 8), pillarMat);
    rightPillar.position.set(8.5, 4, 0);
    const topBar = new THREE.Mesh(new THREE.BoxGeometry(18, 1.2, 1.5), topMat);
    topBar.position.set(0, 8, 0);

    archGroup.add(leftPillar, rightPillar, topBar);
    archGroup.position.set(trackPoints[0].x, 0, trackPoints[0].z);
    archGroup.lookAt(trackPoints[1].x, 0, trackPoints[1].z);
    scene.add(archGroup);

    // Disposer les barrières de collision le long du tracé
    for (let i = 0; i < trackPoints.length; i += 2) {
        let p = trackPoints[i];
        let nextP = trackPoints[(i + 1) % trackPoints.length];
        
        let dir = new THREE.Vector3().subVectors(nextP, p).normalize();
        let normal = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(8.5);

        let barrierMat = new THREE.MeshStandardMaterial({ color: i % 4 === 0 ? 0xdd2222 : 0xf0f0f0, roughness: 0.5 }); 
        let barrierGeom = new THREE.BoxGeometry(0.4, 0.9, 2.8);

        let bExt = new THREE.Mesh(barrierGeom, barrierMat);
        bExt.position.set(p.x + normal.x, 0.45, p.z + normal.z);
        bExt.lookAt(nextP.x + normal.x, 0.45, nextP.z + normal.z);
        scene.add(bExt);
        barriers.push(bExt);

        let bInt = new THREE.Mesh(barrierGeom, barrierMat);
        bInt.position.set(p.x - normal.x, 0.45, p.z - normal.z);
        bInt.lookAt(nextP.x - normal.x, 0.45, nextP.z - normal.z);
        scene.add(bInt);
        barriers.push(bInt);
    }
}

// --- CONCEPTION DE MAQUETTE AUTOMOBILE ---
function createDetailedCar(colorHex) {
    const carGroup = new THREE.Group();
    const c = colorHex === "blue" ? 0x0066ff : (colorHex === "yellow" ? 0xffbb00 : 0xff1100);

    const bodyMat = new THREE.MeshStandardMaterial({ color: c, roughness: 0.2, metalness: 0.6 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.4, 3.4), bodyMat);
    body.position.y = 0.2;
    carGroup.add(body);

    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.45, 1.3), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.1 }));
    cabin.position.set(0, 0.55, -0.1);
    carGroup.add(cabin);

    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.1, 0.4), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    wing.position.set(0, 0.65, -1.5);
    carGroup.add(wing);

    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.8 });
    const wheelGeom = new THREE.CylinderGeometry(0.35, 0.35, 0.4, 16);
    wheelGeom.rotateZ(Math.PI / 2);

    const positions = [[-0.85, 0.15, 1.0], [0.85, 0.15, 1.0], [-0.85, 0.15, -1.0], [0.85, 0.15, -1.0]];
    positions.forEach(pos => {
        let wheel = new THREE.Mesh(wheelGeom, wheelMat);
        wheel.position.set(pos[0], pos[1], pos[2]);
        carGroup.add(wheel);
    });

    return carGroup;
}

function setupInGameUI() {
    const overlay = document.getElementById('ui-overlay');
    
    if(!document.getElementById('lap-container')) {
        const lapDiv = document.createElement('div');
        lapDiv.id = "lap-container";
        lapDiv.innerHTML = `Tour : <span id="lap-count">0/${totalLaps}</span>`;
        lapDiv.style.cssText = "background:rgba(0,0,0,0.8); padding:10px 15px; border-radius:5px; font-size:16px; margin-top:5px; border-left:4px solid #fff; font-weight:bold;";
        overlay.appendChild(lapDiv);

        const nitroDiv = document.createElement('div');
        nitroDiv.style.cssText = "background:rgba(0,0,0,0.8); padding:10px; border-radius:5px; font-size:14px; margin-top:5px; border-left:4px solid #ff4500; width: 180px;";
        nitroDiv.innerHTML = `<div style="margin-bottom:3px; font-weight:bold; color:#ff4500;">BOOST (ESPACE)</div>
                              <div style="background:#333; width:100%; height:12px; border-radius:3px; overflow:hidden;">
                                  <div id="nitro-bar" style="background:linear-gradient(90deg, #ff4500, #ff8c00); width:100%; height:100%;"></div>
                              </div>`;
        overlay.appendChild(nitroDiv);

        const minimapCanvas = document.createElement('canvas');
        minimapCanvas.id = "minimap";
        minimapCanvas.width = 140;
        minimapCanvas.height = 140;
        minimapCanvas.style.cssText = "position:absolute; top:10px; right:10px; background:rgba(0,0,0,0.8); border:2px solid #555; border-radius:8px; z-index:10;";
        document.body.appendChild(minimapCanvas);
        minimapCtx = minimapCanvas.getContext('2d');

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
            cDiv.innerText = "GO !";
            raceStarted = true;
        } else if (countdownNumber < 0) {
            clearInterval(interval);
            cDiv.innerText = "";
        } else {
            cDiv.innerText = countdownNumber;
        }
    }, 1000);
}

function drawMinimap() {
    if (!minimapCtx) return;
    minimapCtx.clearRect(0, 0, 140, 140);
    
    const center = 70;
    const scale = 0.52; 

    minimapCtx.beginPath();
    minimapCtx.strokeStyle = "#444444";
    minimapCtx.lineWidth = 5;
    trackPoints.forEach((pt, idx) => {
        let x = center + pt.x * scale;
        let z = center + pt.z * scale;
        if (idx === 0) minimapCtx.moveTo(x, z);
        else minimapCtx.lineTo(x, z);
    });
    minimapCtx.closePath();
    minimapCtx.stroke();

    bots.forEach(bot => {
        minimapCtx.beginPath();
        minimapCtx.fillStyle = "#ffbb00";
        minimapCtx.arc(center + bot.mesh.position.x * scale, center + bot.mesh.position.z * scale, 3, 0, Math.PI * 2);
        minimapCtx.fill();
    });

    minimapCtx.beginPath();
    minimapCtx.fillStyle = "#ff1100";
    minimapCtx.arc(center + playerCar.position.x * scale, center + playerCar.position.z * scale, 4, 0, Math.PI * 2);
    minimapCtx.fill();
}

function updateCameraView(currentMaxSpeed) {
    let speedRatio = Math.abs(speed) / currentMaxSpeed;
    let targetFOV = 60 + (speedRatio * 15); 
    if (camera.fov !== targetFOV) {
        camera.fov = THREE.MathUtils.lerp(camera.fov, targetFOV, 0.1);
        camera.updateProjectionMatrix();
    }

    if (currentView === "back") {
        const relativeCameraOffset = new THREE.Vector3(0, 2.2, -6.5 - (speedRatio * 1.2)); 
        const cameraOffset = relativeCameraOffset.applyMatrix4(playerCar.matrixWorld);
        camera.position.lerp(cameraOffset, 0.15); 
        camera.lookAt(playerCar.position.clone().add(new THREE.Vector3(0, 0.7, 1.5)));
    } else {
        // Vue à la première personne ajustée sur le nez de la voiture
        const relativeCameraOffset = new THREE.Vector3(0, 0.65, 0.9);
        const cameraOffset = relativeCameraOffset.applyMatrix4(playerCar.matrixWorld);
        camera.position.copy(cameraOffset);
        
        const targetOffset = new THREE.Vector3(0, 0.5, 10).applyMatrix4(playerCar.matrixWorld);
        camera.lookAt(targetOffset);
    }
}

function createParticles(position, colorHex, count) {
    const pGeom = new THREE.BoxGeometry(0.15, 0.15, 0.15);
    const pMat = new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.7 });
    for (let i = 0; i < count; i++) {
        const pMesh = new THREE.Mesh(pGeom, pMat);
        pMesh.position.set(position.x + (Math.random()-0.5)*0.5, position.y, position.z + (Math.random()-0.5)*0.5);
        scene.add(pMesh);
        particleSystems.push({ mesh: pMesh, life: 1.0, vX: (Math.random()-0.5)*0.05, vY: Math.random()*0.03, vZ: (Math.random()-0.5)*0.05 });
    }
}

function updateParticles() {
    for (let i = particleSystems.length - 1; i >= 0; i--) {
        let p = particleSystems[i];
        p.mesh.position.x += p.vX; p.mesh.position.y += p.vY; p.mesh.position.z += p.vZ;
        p.life -= 0.05; p.mesh.material.opacity = p.life;
        if (p.life <= 0) {
            scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose();
            particleSystems.splice(i, 1);
        }
    }
}

function handleKeys(e, isPressed) {
    if (e.key.toLowerCase() === 'w' || e.key === 'ArrowUp') keys.w = isPressed;
    if (e.key.toLowerCase() === 's' || e.key === 'ArrowDown') keys.s = isPressed;
    if (e.key.toLowerCase() === 'a' || e.key === 'ArrowLeft') keys.a = isPressed;
    if (e.key.toLowerCase() === 'd' || e.key === 'ArrowRight') keys.d = isPressed;
    if (e.key === ' ') keys.space = isPressed; 

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
