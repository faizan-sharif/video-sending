# P2P Video Share

A browser-based peer-to-peer video sharing app. Two users can connect via a shared Room ID and send MP4 videos directly to each other — no uploads, no cloud storage, no middleman. Video data travels directly between browsers using WebRTC.

---

## How It Works

```
User A (Browser)          Server (Node.js)          User B (Browser)
      |                         |                         |
      |--- create-room -------->|                         |
      |<-- room-created --------|                         |
      |                         |<------- join-room ------|
      |<-- peer-joined ----------|------- room-joined --->|
      |                         |                         |
      |<===== WebRTC Handshake (via server) =============>|
      |                         |                         |
      |<============= Direct P2P Video Transfer =========>|
```

The server only handles **room management** and **WebRTC signaling** (connection setup). Once both users are connected, all video data flows **directly between browsers** — the server never sees the file.

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Backend | Node.js + Express | Serves static files |
| Real-time | Socket.IO | Room management + signaling |
| P2P Connection | WebRTC (`RTCPeerConnection`) | Direct browser-to-browser tunnel |
| File Transfer | WebRTC `RTCDataChannel` | Sending file chunks |
| NAT Traversal | Google STUN servers | Helps users on different networks connect |

---

## Project Structure

```
p2p-video-share/
├── server/
│   └── index.js        # Node.js server — rooms, signaling, Socket.IO
├── public/
│   ├── index.html      # UI — lobby screen + room screen
│   ├── css/
│   │   └── style.css   # Minimal styles
│   └── js/
│       └── app.js      # All WebRTC + DataChannel + file transfer logic
├── package.json
└── README.md
```

---

## Setup & Installation

**Requirements:** Node.js v14 or higher

```bash
# 1. Install dependencies
npm install

# 2. Start the server
npm start

# 3. For development (auto-restarts on file change)
npm run dev
```

Server runs at **http://localhost:3000**

---

## Usage

Open `http://localhost:3000` in **two separate browser tabs or windows** (or on two different devices on the same network).

### User A — Creating a Room

1. Click **Create Room**
2. A Room ID is generated (e.g. `XKQB3N7M`)
3. Copy and share this ID with User B
4. Wait — the screen will automatically switch when User B joins

### User B — Joining a Room

1. Enter the Room ID received from User A
2. Click **Join Room**
3. Both users are now connected

### Sending a Video

Both users can send and receive simultaneously:

1. Click **Choose File** and select an MP4 video
2. Click **Send**
3. A progress bar shows transfer status
4. When the transfer completes, the other user sees a **Download** button

---

## Architecture Deep Dive

### 1. Signaling (Connection Setup)

Before two browsers can talk directly, they need to exchange connection information. This is called **signaling** and is handled by the Node.js server via Socket.IO.

Three things are exchanged through the server:

- **Offer** — Creator sends their connection description
- **Answer** — Joiner responds with their connection description  
- **ICE Candidates** — Both sides share their network paths (IP addresses, ports)

Once this handshake is complete, the server is no longer involved in the connection.

### 2. WebRTC Connection

```js
const peerConnection = new RTCPeerConnection({
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
});
```

`RTCPeerConnection` is the browser's built-in API for direct peer-to-peer communication. STUN servers help users behind NAT/routers discover their public IP address so they can reach each other.

### 3. Bidirectional DataChannels

Each peer creates their own outgoing channel and receives the other's incoming channel:

```
User A creates  → "file-creator" channel → User B receives it (recvChannel)
User B creates  → "file-joiner"  channel → User A receives it (recvChannel)
```

This gives both users a dedicated send and receive lane — fully bidirectional.

### 4. File Transfer (Chunking)

Files are split into **64 KB chunks** to avoid overwhelming the DataChannel buffer:

```
File (e.g. 100 MB)
  │
  ├── Chunk 1 (64 KB) ──→ sent
  ├── Chunk 2 (64 KB) ──→ sent
  ├── Chunk 3 (64 KB) ──→ sent
  │   ... (backpressure check at each step)
  └── Last chunk       ──→ sent → receiver assembles → download ready
```

If the internal buffer fills up (slow network), sending is paused and resumed automatically via `onbufferedamountlow`.

### 5. File Assembly

The receiver collects all chunks in an array, then combines them into a `Blob`:

```js
const blob = new Blob(receiveBuffer, { type: "video/mp4" });
const url  = URL.createObjectURL(blob);
// url is something like: blob:http://localhost:3000/abc-123
```

This creates a temporary in-browser URL that triggers a real file download.

---

## Room Lifecycle

```
[Room Created]  →  creator: socketA, joiner: null
[Peer Joins]    →  creator: socketA, joiner: socketB
[Joiner Leaves] →  creator: socketA, joiner: null   (room stays open)
[Creator Leaves]→  room deleted entirely
```

Rooms exist only in server memory — they are lost on server restart.

---

## Limitations & Notes

**Same network (LAN):** Works out of the box. STUN is sufficient for users on the same network or with open NATs.

**Different networks (internet):** May fail if both users are behind strict NATs or firewalls. To fix this, add a **TURN server** to `RTC_CONFIG` in `public/js/app.js`:

```js
const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    {
      urls: "turn:your-turn-server.com",
      username: "user",
      credential: "password"
    }
  ]
};
```

Free TURN servers: [Open Relay](https://www.metered.ca/tools/openrelay/)

**File types:** The file picker is limited to `.mp4` but the DataChannel itself can transfer any binary file. Change `accept="video/mp4"` in `index.html` to allow other types.

**Large files:** Very large files (500 MB+) are held in browser memory during transfer. Performance depends on available RAM and network speed.

**Two users max:** Rooms support exactly 2 users. Multi-user support would require a mesh or SFU architecture.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port the server listens on |

```bash
PORT=8080 npm start
```

---

## Scripts

| Command | Description |
|---|---|
| `npm start` | Start the production server |
| `npm run dev` | Start with nodemon (auto-reload on changes) |
