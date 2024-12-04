  const express = require("express");
  const cors = require("cors");
  const { Server } = require("socket.io");
  const http = require("http");

  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { 
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  app.use(cors());
  app.use(express.json());

  const rooms = new Map();

  io.on("connection", (socket) => {
    console.log("a user connected");

    socket.on("joinRoom", ({ room, username }) => {
      socket.join(room);
      socket.username = username;
      
      if (!rooms.has(room)) {
        rooms.set(room, new Set());
      }
      rooms.get(room).add(socket.id);

      console.log(`User ${username} joined room: ${room}`);

      // Send list of current users to the new user
      const currentUsers = Array.from(rooms.get(room)).filter(id => id !== socket.id);
      socket.emit("currentUsers", currentUsers);

      // Notify other users in the room
      socket.to(room).emit("userJoined", socket.id);
    });

    socket.on("startSharing", (room) => {
      socket.to(room).emit("startCall", socket.id);
    });

    socket.on("sendMessage", (data) => {
      io.to(data.room).emit("receiveMessage", data);
    });

    socket.on("offer", (id, message) => {
      socket.to(id).emit("offer", socket.id, message);
    });

    socket.on("answer", (id, message) => {
      socket.to(id).emit("answer", socket.id, message);
    });

    socket.on("candidate", (id, message) => {
      socket.to(id).emit("candidate", socket.id, message);
    });

    socket.on("cameraStatusChange", ({ room, isOn, to }) => {
      if (to) {
        socket.to(to).emit("cameraStatusChange", { userId: socket.id, isOn });
      } else {
        socket.to(room).emit("cameraStatusChange", { userId: socket.id, isOn });
      }
    });

    socket.on("requestUserStatus", ({ to, from }) => {
      socket.to(to).emit("requestUserStatus", { from });
    });

    socket.on("userStatus", ({ to, isCameraOn }) => {
      socket.to(to).emit("userStatus", { from: socket.id, isCameraOn });
    });

    socket.on("requestOffer", ({ to, from }) => {
      socket.to(to).emit("requestOffer", { from });
    });

    socket.on("disconnect", () => {
      console.log("user disconnected");
      rooms.forEach((users, room) => {
        if (users.has(socket.id)) {
          users.delete(socket.id);
          if (users.size === 0) {
            rooms.delete(room);
          } else {
            // Notify other users in the room that this user has left
            socket.to(room).emit("userLeft", socket.id);
          }
        }
      });
    });
  });

  app.get("/", (req, res) => {
    res.send("Server is running");
  });

  server.listen(5000, () => {
    console.log("Server is running on port 5000");
  });