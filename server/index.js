const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "../public")));
const rooms = {};

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  socket.on("create-room", (roomId) => {
    cleanupSocket(socket.id);

    if (rooms[roomId] && rooms[roomId].creator !== socket.id) {
      socket.emit("room-error", "Room ID already taken. Try again.");
      return;
    }

    rooms[roomId] = { creator: socket.id, joiner: null };
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.emit("room-created", roomId);
    console.log(`Room created: ${roomId}`);
  });

  socket.on("join-room", (roomId) => {
    const room = rooms[roomId];
    if (!room) {
      socket.emit("room-error", "Room not found with this ID.");
      return;
    }
    if (room.joiner) {
      socket.emit("room-error", "Room is full");
      return;
    }
    if (room.creator === socket.id) {
      socket.emit("room-error", "Share the ID with someone else.");
      return;
    }

    room.joiner = socket.id;
    socket.join(roomId);
    socket.data.roomId = roomId;

    socket.emit("room-joined", roomId);
    io.to(room.creator).emit("peer-joined");
    console.log(`${socket.id} joined room: ${roomId}`);
  });

  socket.on("offer", ({ roomId, offer }) => {
    socket.to(roomId).emit("offer", offer);
  });

  socket.on("answer", ({ roomId, answer }) => {
    socket.to(roomId).emit("answer", answer);
  });

  socket.on("ice-candidate", ({ roomId, candidate }) => {
    socket.to(roomId).emit("ice-candidate", candidate);
  });

  socket.on("disconnect", () => {
    cleanupSocket(socket.id);
    console.log("Disconnected:", socket.id);
  });

  function cleanupSocket(id) {
    for (const roomId in rooms) {
      const room = rooms[roomId];
      if (room.creator === id || room.joiner === id) {
        socket.to(roomId).emit("peer-disconnected");
        if (room.creator === id) {
          delete rooms[roomId];
        } else {
          room.joiner = null;
        }
        console.log(`Cleaned up room ${roomId} (${id} left)`);
        break;
      }
    }
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
