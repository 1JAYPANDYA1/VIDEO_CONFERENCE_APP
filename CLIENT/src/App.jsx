import React, { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
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
  const [screenStream, setScreenStream] = useState(null);
  const [localStream, setLocalStream] = useState(null);
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

      if (localStream) {
        const peerConnection = await createPeerConnection(userId);
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit("offer", userId, offer);
      }
    });

    socket.on("currentUsers", (users) => {
      setOtherUsers(users);
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

    socket.on("mediaStatusChanged", ({ userId, mediaType, isEnabled }) => {
      console.log(`Media status changed: ${userId}, ${mediaType}, ${isEnabled}`);

      const remoteVideo = document.getElementById(`remote-video-${userId}`);
      if (remoteVideo && remoteVideo.srcObject) {
        const tracks = remoteVideo.srcObject.getTracks();
        tracks.forEach(track => {
          if (track.kind === mediaType) {
            track.enabled = isEnabled;
          }
        });
      }
    });

    return () => {
      socket.off("receiveMessage");
      socket.off("userJoined");
      socket.off("offer");
      socket.off("answer");
      socket.off("candidate");
      socket.off("currentUsers");
      socket.off("userLeft");
      socket.off("mediaStatusChanged");
    };
  }, [localStream, peerConnections]);

  const createPeerConnection = async (userId) => {
    console.log("i am sop")
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
        remoteVideo.autoPlay = true;
        remoteVideo.playsInline = true;
        document.getElementById('remote-videos').appendChild(remoteVideo);
      }
      remoteVideo.srcObject = event.streams[0];
    };

    if (localStream) {
      localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
      });
    }

    setPeerConnections(prev => ({ ...prev, [userId]: peerConnection }));
    return peerConnection;
  };

  const joinRoom = () => {
    socket.emit("joinRoom", { room, username });
    setIsInRoom(true);
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
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: isMicOn
        });

        localVideoRef.current.srcObject = stream;
        setLocalStream(stream);
        setIsCameraOn(true);

        Object.values(peerConnections).forEach(pc => {
          const videoTrack = stream.getVideoTracks()[0];
          const sender = pc.getSenders().find(s => s.track.kind === 'video');
          if (sender) {
            sender.replaceTrack(videoTrack);
          }
        });

        socket.emit("mediaStatusChanged", {
          room,
          mediaType: 'video',
          isEnabled: true
        });
      } catch (error) {
        console.error("Error accessing camera:", error);
      }
    } else {
      if (localStream) {
        const videoTracks = localStream.getVideoTracks();
        videoTracks.forEach(track => track.stop());

        Object.values(peerConnections).forEach(pc => {
          const sender = pc.getSenders().find(s => s.track.kind === 'video');
          if (sender) {
            sender.track.enabled = false;
          }
        });

        socket.emit("mediaStatusChanged", {
          room,
          mediaType: 'video',
          isEnabled: false
        });

        setIsCameraOn(false);
      }
    }
  };

  const toggleMic = async () => {
    if (!isMicOn) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true
        });

        if (localStream) {
          const audioTrack = stream.getAudioTracks()[0];
          localStream.addTrack(audioTrack);
        }

        setIsMicOn(true);

        Object.values(peerConnections).forEach(pc => {
          const audioTrack = stream.getAudioTracks()[0];
          const sender = pc.getSenders().find(s => s.track.kind === 'audio');
          if (sender) {
            sender.replaceTrack(audioTrack);
          }
        });

        socket.emit("mediaStatusChanged", {
          room,
          mediaType: 'audio',
          isEnabled: true
        });
      } catch (error) {
        console.error("Error accessing microphone:", error);
      }
    } else {
      if (localStream) {
        const audioTracks = localStream.getAudioTracks();
        audioTracks.forEach(track => track.stop());

        Object.values(peerConnections).forEach(pc => {
          const sender = pc.getSenders().find(s => s.track.kind === 'audio');
          if (sender) {
            sender.track.enabled = false;
          }
        });

        socket.emit("mediaStatusChanged", {
          room,
          mediaType: 'audio',
          isEnabled: false
        });

        setIsMicOn(false);
      }
    }
  };

  const toggleScreenShare = async () => {
    if (!isScreenSharing) {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        setScreenStream(stream);
        localVideoRef.current.srcObject = stream;
        setIsScreenSharing(true);

        Object.values(peerConnections).forEach(pc => {
          stream.getTracks().forEach(track => {
            pc.addTrack(track, stream);
          });
        });

        socket.emit("screenShare", { room, isSharing: true });

        stream.getVideoTracks()[0].onended = () => {
          stopScreenSharing();
        };
      } catch (error) {
        console.error("Error sharing screen:", error);
      }
    } else {
      stopScreenSharing();
    }
  };

  const stopScreenSharing = async () => {
    if (screenStream) {
      screenStream.getTracks().forEach(track => track.stop());
      setScreenStream(null);
    }
    if (localVideoRef.current.srcObject) {
      localVideoRef.current.srcObject.getTracks().forEach(track => track.stop());
    }
    localVideoRef.current.srcObject = null;
    setIsScreenSharing(false);
    socket.emit("screenShare", { room, isSharing: false });

    if (isCameraOn) {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: isMicOn })
      localVideoRef.current.srcObject = stream;
      Object.values(peerConnections).forEach(pc => {
        stream.getTracks().forEach(track => {
          pc.addTrack(track, stream);
        });
      });
      socket.emit("cameraStatusChange", { room, isOn: true });
    }
  }

  return (
    <div className="flex flex-col items-center p-5">
      <div className="space-y-4 w-full max-w-xs">
        <input
          type="text"
          placeholder="Enter your username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full p-2 border border-gray-300 rounded"
        />
        <input
          type="text"
          placeholder="Enter room number"
          value={room}
          onChange={(e) => setRoom(e.target.value)}
          className="w-full p-2 border border-gray-300 rounded"
        />
        <button
          onClick={joinRoom}
          className="w-full p-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Join Room
        </button>
      </div>

      {isInRoom && (
        <div className="mt-5 w-full">
          <div className="flex justify-center space-x-4 mt-5">
            <button
              onClick={toggleCamera}
              className="p-2 bg-teal-500 text-white rounded hover:bg-teal-600"
            >
              {isCameraOn ? "Turn Off Camera" : "Turn On Camera"}
            </button>
            <button
              onClick={toggleMic}
              className="p-2 bg-orange-500 text-white rounded hover:bg-orange-600"
            >
              {isMicOn ? "Turn Off Mic" : "Turn On Mic"}
            </button>
            <button
              onClick={toggleScreenShare}
              className="p-2 bg-purple-500 text-white rounded hover:bg-purple-600"
            >
              {isScreenSharing ? "Stop Sharing" : "Share Screen"}
            </button>
          </div>

          <div className="mt-5 w-full">
            <div className="flex flex-col items-center">
              <video
                ref={localVideoRef}
                id="local-video"
                autoPlay
                playsInline
                muted
                className="w-full sm:w-80 h-auto rounded-lg shadow-md"
                style={{ height: "15rem", width: "20rem" }}
              ></video>

              <div className="flex justify-center space-x-4 mt-5" id="remote-videos">
                {/* Remote videos will be appended here */}
              </div>
            </div>
          </div>

          <div className="mt-5 w-full">
            <h2 className="text-center text-lg font-semibold">Chat</h2>
            <div className="flex flex-col items-center w-full">
              <div
                id="message-container"
                className="w-full max-h-48 overflow-y-auto bg-gray-100 rounded-md p-3 space-y-2"
              >
                {messages.map((msg, index) => (
                  <div
                    key={index}
                    className="w-full p-2 bg-blue-50 rounded-md shadow-md"
                  >
                    <p className="text-sm">
                      <strong>{msg.user}</strong>: {msg.message}
                    </p>
                    <p className="text-xs text-gray-500">
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </p>
                  </div>  
                ))}
              </div>

              <div className="flex w-full space-x-2 mt-3">
                <input
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Type a message..."
                  className="w-full p-2 border border-gray-300 rounded"
                />
                <button
                  onClick={sendMessage}
                  className="p-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;