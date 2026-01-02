const socket = io();

// Elementos DOM
const connectScreen = document.getElementById('connect-screen');
const controllerScreen = document.getElementById('controller-screen');
const roomInput = document.getElementById('room-input');
const connectBtn = document.getElementById('connect-btn');
const errorMsg = document.getElementById('error-msg');
const shootBtn = document.getElementById('shoot-btn');
const gyroWarning = document.getElementById('gyro-warning');
const betaVal = document.getElementById('beta-val');
const gammaVal = document.getElementById('gamma-val');
const debugStatus = document.getElementById('debug-status');
const aimArea = document.getElementById('aim-area');
const aimDot = document.getElementById('aim-dot');
const calibrateBtn = document.getElementById('calibrate-btn');

let gyroEnabled = false;
let gyroPermissionGranted = false;
let sendInterval = null;
let currentGyro = { beta: 0, gamma: 0 };
let useTouchFallback = false;

// Detectar plataforma
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
              (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /Android/.test(navigator.userAgent);

// Calibración del giroscopio
let gyroCalibration = { beta: 0, gamma: 0 };
let isCalibrated = false;

function setDebug(msg) {
  if (debugStatus) debugStatus.textContent = 'Estado: ' + msg;
  console.log('[Controller]', msg);
}

// Socket events
socket.on('connect', () => {
  setDebug('Socket conectado');
  // Auto-conectar si viene código en URL
  const params = new URLSearchParams(window.location.search);
  const roomCode = params.get('room');
  if (roomCode && roomCode.length === 4) {
    roomInput.value = roomCode;
    connect();
  }
});

socket.on('disconnect', () => {
  setDebug('Socket desconectado');
});

// Conectar a sala
connectBtn.addEventListener('click', connect);
roomInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') connect();
});

function connect() {
  const roomCode = roomInput.value.trim();
  if (roomCode.length !== 4) {
    errorMsg.textContent = 'Ingresa un código de 4 dígitos';
    return;
  }

  errorMsg.textContent = 'Conectando...';
  connectBtn.disabled = true;
  setDebug('Conectando a sala ' + roomCode);

  socket.emit('join-room', roomCode, (response) => {
    if (response.success) {
      setDebug('Conectado a sala ' + roomCode);
      connectScreen.classList.add('hidden');
      controllerScreen.classList.remove('hidden');
      initGyroscope();
      initShootButton();
      initTouchAim();
      startSendingGyro();
    } else {
      errorMsg.textContent = response.error;
      connectBtn.disabled = false;
      setDebug('Error: ' + response.error);
    }
  });
}

// Inicializar giroscopio
function initGyroscope() {
  setDebug('Verificando giroscopio... ' + (isIOS ? 'iOS' : isAndroid ? 'Android' : 'Otro'));

  // Verificar HTTPS (requerido para giroscopio en móviles)
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    setDebug('HTTPS requerido para giroscopio');
    gyroWarning.classList.remove('hidden');
    gyroWarning.textContent = 'Giroscopio requiere HTTPS. Usa el área táctil para apuntar.';
    useTouchFallback = true;
    return;
  }

  // iOS 13+ requiere permiso explícito
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    setDebug('iOS detectado, requiere permiso');
    gyroWarning.classList.remove('hidden');
    gyroWarning.textContent = 'Toca DISPARAR para activar el sensor de movimiento';
  }
  // Android y otros dispositivos
  else if (window.DeviceOrientationEvent) {
    setDebug('Activando giroscopio...');
    // En Android, intentar deviceorientationabsolute primero para mejor precisión
    if (isAndroid && 'ondeviceorientationabsolute' in window) {
      window.addEventListener('deviceorientationabsolute', handleOrientation);
      gyroEnabled = true;
      setDebug('Giroscopio absoluto activo (Android)');
    } else {
      startGyroscope();
    }
  } else {
    setDebug('Giroscopio no disponible');
    gyroWarning.classList.remove('hidden');
    gyroWarning.textContent = 'Giroscopio no disponible. Usa el área táctil.';
    useTouchFallback = true;
  }
}

async function requestGyroPermission() {
  if (gyroPermissionGranted) return true;

  setDebug('Solicitando permiso...');
  try {
    const permission = await DeviceOrientationEvent.requestPermission();
    if (permission === 'granted') {
      setDebug('Permiso concedido');
      gyroWarning.classList.add('hidden');
      gyroPermissionGranted = true;
      startGyroscope();

      // Verificar si realmente recibimos datos después de un momento
      setTimeout(() => {
        if (!isCalibrated) {
          setDebug('Sensor activo pero sin datos');
          gyroWarning.classList.remove('hidden');
          gyroWarning.textContent = 'Sensor sin respuesta. Verifica Ajustes > Privacidad > Sensores de movimiento.';
        }
      }, 2000);

      return true;
    } else {
      setDebug('Permiso denegado');
      gyroWarning.classList.remove('hidden');
      gyroWarning.textContent = 'Permiso denegado. Usa el área táctil para apuntar.';
      useTouchFallback = true;
      return false;
    }
  } catch (error) {
    setDebug('Error permiso: ' + error.message);
    gyroWarning.classList.remove('hidden');

    // Mensaje específico para errores comunes de iOS
    if (error.message.includes('denied') || error.message.includes('NotAllowedError')) {
      gyroWarning.textContent = 'Permiso bloqueado. Ve a Ajustes > Safari > Movimiento y orientación.';
    } else {
      gyroWarning.textContent = 'Error: ' + error.message + '. Usa el área táctil.';
    }
    useTouchFallback = true;
    return false;
  }
}

function startGyroscope() {
  if (gyroEnabled) return;

  window.addEventListener('deviceorientation', handleOrientation);
  gyroEnabled = true;
  gyroWarning.classList.add('hidden');
  setDebug('Giroscopio activo');
}

// Función para recalibrar el giroscopio
function calibrateGyro() {
  isCalibrated = false;
  gyroCalibration = { beta: 0, gamma: 0 };
  setDebug('Calibrando... apunta al centro');

  // Feedback visual
  if (calibrateBtn) {
    calibrateBtn.textContent = '...';
    setTimeout(() => {
      calibrateBtn.textContent = 'Calibrar';
    }, 1000);
  }
}

// Inicializar botón de calibración
if (calibrateBtn) {
  calibrateBtn.addEventListener('click', calibrateGyro);
  calibrateBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    calibrateGyro();
  }, { passive: false });
}

function startSendingGyro() {
  if (sendInterval) return;

  sendInterval = setInterval(() => {
    socket.emit('gyro-data', currentGyro);
  }, 50);
  setDebug('Enviando datos cada 50ms');
}

function handleOrientation(event) {
  if (event.beta === null && event.gamma === null) {
    setDebug('Giroscopio sin datos');
    useTouchFallback = true;
    return;
  }

  let beta = event.beta || 0;
  let gamma = event.gamma || 0;

  // Calibrar en la primera lectura válida
  if (!isCalibrated && (beta !== 0 || gamma !== 0)) {
    gyroCalibration.beta = beta - 45; // Asumir que apunta al centro inicialmente
    gyroCalibration.gamma = gamma;
    isCalibrated = true;
    setDebug('Giroscopio calibrado');
  }

  // Aplicar calibración
  beta = beta - gyroCalibration.beta;
  gamma = gamma - gyroCalibration.gamma;

  // Manejar orientación de pantalla
  const orientation = screen.orientation ? screen.orientation.angle :
                     (window.orientation || 0);

  if (orientation === 90 || orientation === -90) {
    // Landscape: intercambiar ejes
    [beta, gamma] = [gamma, beta];
    if (orientation === 90) gamma = -gamma;
    if (orientation === -90) beta = -beta;
  }

  // Limitar rangos para evitar valores extremos
  beta = Math.max(-90, Math.min(90, beta));
  gamma = Math.max(-90, Math.min(90, gamma));

  currentGyro.beta = beta;
  currentGyro.gamma = gamma;

  betaVal.textContent = beta.toFixed(1);
  gammaVal.textContent = gamma.toFixed(1);

  // Actualizar punto visual en área táctil para feedback
  if (aimDot && aimArea) {
    const rect = aimArea.getBoundingClientRect();
    const x = ((gamma + 45) / 90) * rect.width;
    const y = ((beta - 15 + 45) / 90) * rect.height;
    aimDot.style.left = Math.max(0, Math.min(rect.width, x)) + 'px';
    aimDot.style.top = Math.max(0, Math.min(rect.height, y)) + 'px';
  }
}

// Control táctil (fallback)
function initTouchAim() {
  let touching = false;

  aimArea.addEventListener('touchstart', (e) => {
    e.preventDefault();
    touching = true;
    updateTouchAim(e.touches[0]);
  }, { passive: false });

  aimArea.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (touching) {
      updateTouchAim(e.touches[0]);
    }
  }, { passive: false });

  aimArea.addEventListener('touchend', () => {
    touching = false;
  });

  // Mouse fallback para testing
  aimArea.addEventListener('mousedown', (e) => {
    touching = true;
    updateMouseAim(e);
  });

  aimArea.addEventListener('mousemove', (e) => {
    if (touching) updateMouseAim(e);
  });

  aimArea.addEventListener('mouseup', () => {
    touching = false;
  });

  aimArea.addEventListener('mouseleave', () => {
    touching = false;
  });
}

function updateTouchAim(touch) {
  const rect = aimArea.getBoundingClientRect();
  const x = touch.clientX - rect.left;
  const y = touch.clientY - rect.top;
  updateAimPosition(x, y, rect.width, rect.height);
}

function updateMouseAim(e) {
  const rect = aimArea.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  updateAimPosition(x, y, rect.width, rect.height);
}

function updateAimPosition(x, y, width, height) {
  // Limitar a los bordes
  x = Math.max(0, Math.min(width, x));
  y = Math.max(0, Math.min(height, y));

  // Mover el punto visual
  aimDot.style.left = x + 'px';
  aimDot.style.top = y + 'px';

  // Convertir a valores de giroscopio (-45 a 45 para gamma, -30 a 60 para beta)
  currentGyro.gamma = ((x / width) - 0.5) * 90;  // -45 a 45
  currentGyro.beta = ((y / height) - 0.5) * 90 + 15; // -30 a 60

  betaVal.textContent = currentGyro.beta.toFixed(1);
  gammaVal.textContent = currentGyro.gamma.toFixed(1);
}

// Botón de disparo
function initShootButton() {
  shootBtn.addEventListener('touchstart', handleShoot, { passive: false });
  shootBtn.addEventListener('mousedown', handleShoot);
}

async function handleShoot(e) {
  e.preventDefault();

  // En iOS, pedir permiso del giroscopio con el primer toque
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function' &&
      !gyroPermissionGranted && !useTouchFallback) {
    await requestGyroPermission();
  }

  shoot();
}

function shoot() {
  socket.emit('shoot');
  setDebug('¡Disparo!');

  // Efecto visual mejorado
  shootBtn.style.transform = 'translateY(6px)';
  shootBtn.style.boxShadow = '0 2px 0 #8b0000, 0 4px 10px rgba(0, 0, 0, 0.3)';
  shootBtn.style.background = 'linear-gradient(145deg, #ff6b6b, #e74c3c)';

  setTimeout(() => {
    shootBtn.style.transform = '';
    shootBtn.style.boxShadow = '';
    shootBtn.style.background = '';
  }, 100);

  // Vibración táctil (funciona en Android, limitado en iOS)
  if (navigator.vibrate) {
    navigator.vibrate(50);
  }

  // Feedback de audio corto (opcional, funciona mejor en iOS)
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    oscillator.frequency.value = 150;
    gainNode.gain.value = 0.1;
    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.05);
  } catch (e) {
    // Audio no disponible, ignorar
  }
}

// Manejar desconexión del juego
socket.on('game-disconnected', () => {
  controllerScreen.classList.add('hidden');
  connectScreen.classList.remove('hidden');
  errorMsg.textContent = 'El juego se desconectó';
  connectBtn.disabled = false;
  roomInput.value = '';

  if (sendInterval) {
    clearInterval(sendInterval);
    sendInterval = null;
  }
  gyroEnabled = false;
  gyroPermissionGranted = false;
  setDebug('Juego desconectado');
});

// Prevenir scroll y zoom
document.addEventListener('touchmove', (e) => {
  if (e.target.closest('#aim-area')) return;
  e.preventDefault();
}, { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault());
