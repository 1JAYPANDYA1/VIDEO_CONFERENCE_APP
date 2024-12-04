  import React, { useEffect, useState, useRef } from "react";
  import { io } from "socket.io-client";
  import {
    Box,
    Button,
    Input,
    Flex,
    Text,
    VStack,
    HStack
  } from "@chakra-ui/react";
  import './App.css';

  const socket = io("http://localhost:5000");

  function App() {
    const [messages, setMessages] = useState([]);
    const [message, setMessage] = useState("");
    const [username, setUsername] = useState("");
    const [room, setRoom] = useState("");
    const [isCameraOn, setIsCameraOn] = useState(false);
    const [isMicOn, setIsMicOn] = useState(false);
    const [isScreenSharing, setIsScreenSharing] = useState(false);
    const [isInRoom, setIsInRoom] = useState(false);
    const [otherUsers, setOtherUsers] = useState([]);
    const [peerConnections, setPeerConnections] = useState({});
    const localVideoRef = useRef(null);

    const config = {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" }
      ]
    };

    useEffect(() => {
      socket.on("receiveMessage", (message) => {
        setMessages((prev) => [...prev, message]);
      });

      socket.on("userJoined", async (userId) => {
        console.log("New user joined:", userId);
        setOtherUsers(prev => [...prev, userId]);
        if (isCameraOn) {
          const peerConnection = await createPeerConnection(userId);
          const offer = await peerConnection.createOffer();
          await peerConnection.setLocalDescription(offer);
          socket.emit("offer", userId, offer);
        }
      });

      socket.on("currentUsers", (users) => {
        setOtherUsers(users);
        users.forEach(userId => {
          socket.emit("requestUserStatus", { to: userId, from: socket.id });
        });
      });

      socket.on("userLeft", (userId) => {
        setOtherUsers(prev => prev.filter(id => id !== userId));
        const peerConnection = peerConnections[userId];
        if (peerConnection) {
          peerConnection.close();
          setPeerConnections(prev => {
            const newConnections = { ...prev };
            delete newConnections[userId];
            return newConnections;
          });
        }
        const remoteVideo = document.getElementById(`remote-video-${userId}`);
        if (remoteVideo) {
          remoteVideo.remove();
        }
      });

      socket.on("userStatus", async ({ from, isCameraOn }) => {
        if (isCameraOn) {
          await createPeerConnection(from);
          socket.emit("requestOffer", { to: from, from: socket.id });
        }
      });

      socket.on("offer", async (userId, description) => {
        let peerConnection = peerConnections[userId];
        if (!peerConnection) {
          peerConnection = await createPeerConnection(userId);
        }
        await peerConnection.setRemoteDescription(description);
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit("answer", userId, answer);
      });

      socket.on("answer", async (userId, description) => {
        const peerConnection = peerConnections[userId];
        if (peerConnection) {
          await peerConnection.setRemoteDescription(description);
        }
      });

      socket.on("candidate", async (userId, candidate) => {
        const peerConnection = peerConnections[userId];
        if (peerConnection) {
          await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        }
      });

      socket.on("cameraStatusChange", async ({ userId, isOn }) => {
        if (isOn) {
          if (!peerConnections[userId]) {
            await createPeerConnection(userId);
          }
          socket.emit("requestOffer", { to: userId, from: socket.id });
        } else {
          const remoteVideo = document.getElementById(`remote-video-${userId}`);
          if (remoteVideo) {
            remoteVideo.srcObject = null;
          }
        }
      });

      socket.on("requestOffer", async ({ from }) => {
        let peerConnection = peerConnections[from];
        if (!peerConnection) {
          peerConnection = await createPeerConnection(from);
        }
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit("offer", from, offer);
      });

      return () => {
        socket.off("receiveMessage");
        socket.off("userJoined");
        socket.off("offer");
        socket.off("answer");
        socket.off("candidate");
        socket.off("cameraStatusChange");
        socket.off("requestOffer");
        socket.off("currentUsers");
        socket.off("userLeft");
        socket.off("userStatus");
      };
    }, [isCameraOn, room, peerConnections]);

    const createPeerConnection = async (userId) => {
      const peerConnection = new RTCPeerConnection(config);
      
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit("candidate", userId, event.candidate);
        }
      };

      peerConnection.ontrack = (event) => {
        let remoteVideo = document.getElementById(`remote-video-${userId}`);
        if (!remoteVideo) {
          remoteVideo = document.createElement('video');
          remoteVideo.id = `remote-video-${userId}`;
          remoteVideo.autoplay = true;
          remoteVideo.playsInline = true;
          document.getElementById('remote-videos').appendChild(remoteVideo);
        }
        remoteVideo.srcObject = event.streams[0];
      };

      if (localVideoRef.current && localVideoRef.current.srcObject) {
        localVideoRef.current.srcObject.getTracks().forEach(track => {
          peerConnection.addTrack(track, localVideoRef.current.srcObject);
        });
      }

      setPeerConnections(prev => ({ ...prev, [userId]: peerConnection }));
      return peerConnection;
    };

    const joinRoom = () => {
      if (room !== "" && username !== "" && !isInRoom) {
        socket.emit("joinRoom", { room, username });
        setIsInRoom(true);
      }
    };

    const sendMessage = () => {
      const data = {
        user: username,
        message,
        room,
        timestamp: new Date()
      };
      socket.emit("sendMessage", data);
      setMessage("");
    };

    const toggleCamera = async () => {
      if (!isCameraOn) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: isMicOn });
          localVideoRef.current.srcObject = stream;
          setIsCameraOn(true);
          
          Object.values(peerConnections).forEach(pc => {
            stream.getTracks().forEach(track => {
              pc.addTrack(track, stream);
            });
          });

          socket.emit("cameraStatusChange", { room, isOn: true });
        } catch (error) {
          console.error("Error accessing camera:", error);
        }
      } else {
        const stream = localVideoRef.current.srcObject;
        const tracks = stream.getTracks().filter(track => track.kind === 'video');
        tracks.forEach(track => track.stop());
        setIsCameraOn(false);

        socket.emit("cameraStatusChange", { room, isOn: false });
      }
    };

    const toggleMic = async () => {
      if (!isMicOn) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          setIsMicOn(true);

          Object.values(peerConnections).forEach(pc => {
            stream.getTracks().forEach(track => {
              pc.addTrack(track, stream);
            });
          });

          socket.emit("startSharing", room);
        } catch (error) {
          console.error("Error accessing microphone:", error);
        }
      } else {
        const stream = localVideoRef.current.srcObject;
        if (stream) {
          const tracks = stream.getTracks().filter(track => track.kind === 'audio');
          tracks.forEach(track => track.stop());
        }
        setIsMicOn(false);
      }
    };

    const toggleScreenShare = async () => {
      if (!isScreenSharing) {
        try {
          const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
          localVideoRef.current.srcObject = stream;
          setIsScreenSharing(true);

          Object.values(peerConnections).forEach(pc => {
            stream.getTracks().forEach(track => {
              pc.addTrack(track, stream);
            });
          });

          socket.emit("startSharing", room);
        } catch (error) {
          console.error("Error sharing screen:", error);
        }
      } else {
        const stream = localVideoRef.current.srcObject;
        const tracks = stream.getTracks();
        tracks.forEach(track => track.stop());
        localVideoRef.current.srcObject = null;
        setIsScreenSharing(false);
      }
    };

    return (
      <Flex direction="column" align="center" p={5}>
        <VStack>
          <Input
            placeholder="Enter your username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="input-container"
          />
          <Input
            placeholder="Enter room number"
            value={room}
            onChange={(e) => setRoom(e.target.value)}
            className="input-container"
          />
          <Button onClick={joinRoom}>Join Room</Button>
          <video ref={localVideoRef} className="video-player" autoPlay muted></video>
          <div id="remote-videos"></div>
          <HStack className="button-container">
            <Button onClick={toggleCamera}>
              {isCameraOn ? "Turn off Camera" : "Turn on Camera"}
            </Button>
            <Button onClick={toggleMic}>
              {isMicOn ? "Turn off Mic" : "Turn on Mic"}
            </Button>
            <Button onClick={toggleScreenShare}>
              {isScreenSharing ? "Stop Screen Share" : "Share Screen"}
            </Button>
          </HStack>
          <VStack className="chat-container">
            {messages.map((msg, index) => (
              <Box key={index} className="message-box">
                <Text><strong>{msg.user}</strong>: {msg.message}</Text>
              </Box>
            ))}
          </VStack>
          <HStack className="input-container">
            <Input
              placeholder="Enter a message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <Button onClick={sendMessage}>Send</Button>
          </HStack>
        </VStack>
      </Flex>
    );
  }

  export default App;