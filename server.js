const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

// Servir archivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// Rutas principales
app.get('/', (req, res) => {
  res.redirect('/game');
});

app.get('/game', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/game/index.html'));
});

app.get('/controller', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/controller/index.html'));
});

// Estado de las salas
const rooms = new Map();

function generateRoomCode() {
  let code;
  do {
    code = Math.floor(1000 + Math.random() * 9000).toString();
  } while (rooms.has(code));
  return code;
}

io.on('connection', (socket) => {
  console.log('Cliente conectado:', socket.id);

  // Juego crea una sala
  socket.on('create-room', (callback) => {
    const roomCode = generateRoomCode();
    rooms.set(roomCode, {
      gameSocket: socket.id,
      controllerSocket: null,
      createdAt: Date.now()
    });
    socket.join(roomCode);
    socket.roomCode = roomCode;
    console.log(`Sala creada: ${roomCode}`);
    callback({ success: true, roomCode });
  });

  // Controlador se une a una sala
  socket.on('join-room', (roomCode, callback) => {
    const room = rooms.get(roomCode);
    if (!room) {
      callback({ success: false, error: 'Sala no encontrada' });
      return;
    }
    if (room.controllerSocket) {
      callback({ success: false, error: 'Ya hay un controlador conectado' });
      return;
    }
    room.controllerSocket = socket.id;
    socket.join(roomCode);
    socket.roomCode = roomCode;

    // Notificar al juego que el controlador se conectó
    io.to(room.gameSocket).emit('controller-connected');

    console.log(`Controlador unido a sala: ${roomCode}`);
    callback({ success: true });
  });

  // Datos del giroscopio desde el controlador
  socket.on('gyro-data', (data) => {
    const room = rooms.get(socket.roomCode);
    if (room && room.gameSocket) {
      io.to(room.gameSocket).emit('gyro-update', data);
    }
  });

  // Disparo desde el controlador
  socket.on('shoot', () => {
    const room = rooms.get(socket.roomCode);
    if (room && room.gameSocket) {
      io.to(room.gameSocket).emit('player-shoot');
    }
  });

  // Desconexión
  socket.on('disconnect', () => {
    console.log('Cliente desconectado:', socket.id);
    const roomCode = socket.roomCode;
    if (roomCode && rooms.has(roomCode)) {
      const room = rooms.get(roomCode);
      if (room.gameSocket === socket.id) {
        // El juego se desconectó, eliminar sala
        if (room.controllerSocket) {
          io.to(room.controllerSocket).emit('game-disconnected');
        }
        rooms.delete(roomCode);
        console.log(`Sala eliminada: ${roomCode}`);
      } else if (room.controllerSocket === socket.id) {
        // El controlador se desconectó
        room.controllerSocket = null;
        io.to(room.gameSocket).emit('controller-disconnected');
        console.log(`Controlador desconectado de sala: ${roomCode}`);
      }
    }
  });
});

// Limpiar salas viejas cada 10 minutos
setInterval(() => {
  const now = Date.now();
  const maxAge = 30 * 60 * 1000; // 30 minutos
  for (const [code, room] of rooms) {
    if (now - room.createdAt > maxAge) {
      rooms.delete(code);
      console.log(`Sala expirada eliminada: ${code}`);
    }
  }
}, 10 * 60 * 1000);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`🦖 Ice Age Shooter corriendo en http://localhost:${PORT}`);
  console.log(`   Juego: http://localhost:${PORT}/game`);
  console.log(`   Control: http://localhost:${PORT}/controller`);
});
