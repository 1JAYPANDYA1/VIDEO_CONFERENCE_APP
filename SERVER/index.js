const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const cors = require("cors");

const app = express();
const server = http.createServer(app);

app.use(cors());

const io = socketIO(server, {
    cors: {
        origin: "http://localhost:5173",
        methods: ["GET", "POST"],
    },
});

const usersInRooms = {};

io.on("connection", (socket) => {
    console.log("New user connected:", socket.id);

    socket.on("joinRoom", ({ room, username }) => {
        socket.join(room);
        if (!usersInRooms[room]) {
            usersInRooms[room] = [];
        }
        usersInRooms[room].push({ socketId: socket.id, username });
        socket.to(room).emit("userJoined", socket.id);
        socket.emit("currentUsers", usersInRooms[room].map((user) => user.socketId));
    });

    socket.on("sendMessage", (message) => {
        io.to(message.room).emit("receiveMessage", message);
    });

    socket.on("offer", (to, description) => {
        socket.to(to).emit("offer", socket.id, description);
    });

    socket.on("answer", (to, description) => {
        socket.to(to).emit("answer", socket.id, description);
    });

    socket.on("candidate", (to, candidate) => {
        socket.to(to).emit("candidate", socket.id, candidate);
    });

    socket.on("cameraStatusChange", ({ room, isOn }) => {
        socket.to(room).emit("cameraStatusChange", { userId: socket.id, isOn });
    });

    socket.on("requestOffer", ({ to, from }) => {
        socket.to(to).emit("requestOffer", { from });
    });

    socket.on("requestUserStatus", ({ to, from }) => {
        const userRoom = Object.keys(socket.rooms).find(room => room !== socket.id);
        const user = usersInRooms[userRoom]?.find(user => user.socketId === to);
        if (user) {
            socket.to(to).emit("userStatus", { from, isCameraOn: true });
        }
    });

    socket.on("screenShare", ({ room, isSharing }) => {
        socket.to(room).emit("screenShare", { userId: socket.id, isSharing });
    });

    socket.on("disconnect", () => {
        console.log("User disconnected:", socket.id);
        let room = null;
        for (const [key, value] of Object.entries(usersInRooms)) {
            const userIndex = value.findIndex(user => user.socketId === socket.id);
            if (userIndex !== -1) {
                room = key;
                value.splice(userIndex, 1);
                break;
            }
        }
        if (room) {
            socket.to(room).emit("userLeft", socket.id);
        }
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${ PORT }`));