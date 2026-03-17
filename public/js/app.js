const socket = io();

let roomId = null;
let isCreator = false;
let peerConnection = null;

let sendChannel = null;
let recvChannel = null;
let selectedFile = null;
let receiveBuffer = [];
let receivedSize = 0;
let expectedSize = 0;
let incomingFileName = "";

const CHUNK_SIZE = 64 * 1024;

const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

const lobby      = document.getElementById("lobby");
const roomScreen = document.getElementById("room");

const btnCreate      = document.getElementById("btn-create");
const btnJoin        = document.getElementById("btn-join");
const inputRoomId    = document.getElementById("input-room-id");
const createdRoomDiv = document.getElementById("created-room");
const displayRoomId  = document.getElementById("display-room-id");
const btnCopy        = document.getElementById("btn-copy");
const lobbyError     = document.getElementById("lobby-error");

const roomIdLabel = document.getElementById("room-id-label");
const peerStatus  = document.getElementById("peer-status");
const fileInput       = document.getElementById("file-input");
const fileInfo        = document.getElementById("file-info");
const fileNameDisplay = document.getElementById("file-name-display");
const fileSizeDisplay = document.getElementById("file-size-display");
const btnSend         = document.getElementById("btn-send");

const sendProgress = document.getElementById("send-progress");
const sendBar      = document.getElementById("send-bar");
const sendPct      = document.getElementById("send-pct");

const receiveIdle     = document.getElementById("receive-idle");
const receiveProgress = document.getElementById("receive-progress");
const receiveBar      = document.getElementById("receive-bar");
const receivePct      = document.getElementById("receive-pct");
const receiveFname    = document.getElementById("receive-fname");

const downloadArea  = document.getElementById("download-area");
const receivedFname = document.getElementById("received-fname");
const downloadLink  = document.getElementById("download-link");

const roomError = document.getElementById("room-error");

function showLobbyError(msg) { lobbyError.textContent = msg; lobbyError.classList.remove("hidden"); }
function hideLobbyError()    { lobbyError.classList.add("hidden"); }
function showRoomError(msg)  { roomError.textContent = msg; roomError.classList.remove("hidden"); }

function formatBytes(b) {
  if (b < 1024) return b + " B";
  if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
  return (b / 1048576).toFixed(2) + " MB";
}

function generateRoomId() {
  const c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 8 }, () => c[Math.floor(Math.random() * c.length)]).join("");
}

function switchToRoom(id) {
  roomId = id;
  lobby.classList.add("hidden");
  roomScreen.classList.remove("hidden");
  roomIdLabel.textContent = id;
}

btnCreate.addEventListener("click", () => {
  hideLobbyError();
  btnCreate.disabled = true;
  const id = generateRoomId();
  socket.emit("create-room", id);
});

btnJoin.addEventListener("click", () => {
  hideLobbyError();
  const id = inputRoomId.value.trim().toUpperCase();
  if (!id) { showLobbyError("Enter a Room ID."); return; }
  socket.emit("join-room", id);
});

inputRoomId.addEventListener("keydown", (e) => { if (e.key === "Enter") btnJoin.click(); });

btnCopy.addEventListener("click", () => {
  navigator.clipboard.writeText(displayRoomId.textContent).then(() => {
    btnCopy.textContent = "Copied!";
    setTimeout(() => btnCopy.textContent = "Copy", 1500);
  });
});

socket.on("room-created", (id) => {
  isCreator = true;
  displayRoomId.textContent = id;
  createdRoomDiv.classList.remove("hidden");
});

socket.on("room-joined", (id) => {
  isCreator = false;
  switchToRoom(id);        
  initPeerConnection();
});

socket.on("peer-joined", () => {
  switchToRoom(displayRoomId.textContent);  
  initPeerConnection();
  createOffer();
});

socket.on("offer", async (offer) => {
  if (!peerConnection) initPeerConnection();
  await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  socket.emit("answer", { roomId, answer });
});

socket.on("answer", async (answer) => {
  await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
});

socket.on("ice-candidate", async (candidate) => {
  try { await peerConnection.addIceCandidate(new RTCIceCandidate(candidate)); }
  catch (e) { console.warn("ICE error:", e); }
});

socket.on("peer-disconnected", () => {
  peerStatus.textContent = "Peer disconnected";
  showRoomError("Peer disconnected from the room.");
});

socket.on("room-error", (msg) => {
  btnCreate.disabled = false;
  showLobbyError(msg);
});

function initPeerConnection() {
  peerConnection = new RTCPeerConnection(RTC_CONFIG);

  peerConnection.onicecandidate = ({ candidate }) => {
    if (candidate) socket.emit("ice-candidate", { roomId, candidate });
  };
  peerConnection.onconnectionstatechange = () => {
    const s = peerConnection.connectionState;
    if (s === "connected")                              peerStatus.textContent = "Connected";
    if (["disconnected","failed","closed"].includes(s)) peerStatus.textContent = "Disconnected";
  };
  sendChannel = peerConnection.createDataChannel(
    "file-" + (isCreator ? "creator" : "joiner"),
    { ordered: true }
  );
  setupSendChannel(sendChannel);

  peerConnection.ondatachannel = (event) => {
    recvChannel = event.channel;
    setupRecvChannel(recvChannel);
  };
}

async function createOffer() {
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  socket.emit("offer", { roomId, offer });
}

function setupSendChannel(ch) {
  ch.binaryType = "arraybuffer";
  ch.onopen  = () => { if (selectedFile) btnSend.disabled = false; };
  ch.onclose = () => { btnSend.disabled = true; };
}

function setupRecvChannel(ch) {
  ch.binaryType = "arraybuffer";
  ch.onmessage = (e) => handleIncomingData(e.data);
}

btnSend.addEventListener("click", () => {
  if (!selectedFile || !sendChannel || sendChannel.readyState !== "open") return;
  sendFile(selectedFile);
});

async function sendFile(file) {
  btnSend.disabled = true;
  sendProgress.classList.remove("hidden");

  sendChannel.send(JSON.stringify({ name: file.name, size: file.size }));

  const buffer = await file.arrayBuffer();
  let offset = 0;

  function sendNext() {
    while (offset < buffer.byteLength) {
      if (sendChannel.bufferedAmount > 4 * 1024 * 1024) {
        sendChannel.bufferedAmountLowThreshold = 512 * 1024;
        sendChannel.onbufferedamountlow = sendNext;
        return;
      }
      const end   = Math.min(offset + CHUNK_SIZE, buffer.byteLength);
      const chunk = buffer.slice(offset, end);
      sendChannel.send(chunk);
      offset += chunk.byteLength;

      const pct = Math.round((offset / file.size) * 100);
      sendBar.value       = pct;
      sendPct.textContent = pct + "%";
    }
    sendPct.textContent = "Sent!";
  }

  sendNext();
}

function handleIncomingData(data) {
  if (typeof data === "string") {
    try {
      const meta       = JSON.parse(data);
      incomingFileName = meta.name;
      expectedSize     = meta.size;
      receiveBuffer    = [];
      receivedSize     = 0;

      receiveIdle.classList.add("hidden");
      downloadArea.classList.add("hidden");
      receiveProgress.classList.remove("hidden");
      receiveBar.value         = 0;
      receivePct.textContent   = "0%";
      receiveFname.textContent = incomingFileName;
    } catch (e) { console.error("Meta parse error", e); }
    return;
  }

  receiveBuffer.push(data);
  receivedSize += data.byteLength;

  const pct = Math.min(100, Math.round((receivedSize / expectedSize) * 100));
  receiveBar.value       = pct;
  receivePct.textContent = pct + "%";

  if (receivedSize >= expectedSize) assembleFile();
}

function assembleFile() {
  const blob = new Blob(receiveBuffer, { type: "video/mp4" });
  const url  = URL.createObjectURL(blob);

  receiveProgress.classList.add("hidden");
  downloadArea.classList.remove("hidden");
  receivedFname.textContent = incomingFileName;
  downloadLink.href         = url;
  downloadLink.download     = incomingFileName;
  downloadLink.textContent  = "Download " + incomingFileName;

  receiveBuffer = [];
  receivedSize  = 0;
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (!file) return;
  selectedFile                = file;
  fileInfo.classList.remove("hidden");
  fileNameDisplay.textContent = file.name;
  fileSizeDisplay.textContent = formatBytes(file.size);
  if (sendChannel && sendChannel.readyState === "open") btnSend.disabled = false;
});
