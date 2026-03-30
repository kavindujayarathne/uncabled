// server.js - HTTPS static + WS signaling
import "dotenv/config";
import fs from "fs";
import https from "https";
import os from "os";
import express from "express";
import { WebSocketServer } from "ws";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Config
const TLS_CERT = process.env.TLS_CERT || "cert.pem";
const TLS_KEY = process.env.TLS_KEY || "key.pem";
const PORT = parseInt(process.env.PORT, 10) || 8443;

// Auto-detect LAN IP address
function getLanIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "127.0.0.1";
}

// Verify cert files exist before starting
if (!fs.existsSync(TLS_CERT) || !fs.existsSync(TLS_KEY)) {
  console.error(`TLS certificate files not found: ${TLS_CERT}, ${TLS_KEY}`);
  console.error("Generate local certs with mkcert (see README.md).");
  process.exit(1);
}

// Express (serves index.html and assets)
const app = express();
app.use(express.static(path.join(__dirname, "public")));

// OBS receiver shortcut: /obs-receiver/<room>
app.get('/obs-receiver/:room', (req, res) => {
  const room = req.params.room;
  res.redirect(`/?role=receiver&room=${encodeURIComponent(room)}&obs=1&autostart=1`);
});

// HTTPS server
const server = https.createServer(
  {
    key: fs.readFileSync(TLS_KEY),
    cert: fs.readFileSync(TLS_CERT),
  },
  app
);

const lanIP = getLanIP();

server.listen(PORT, () => {
  console.log(`HTTPS server running at https://${lanIP}:${PORT}`);
});

// WebSocket signaling
const wss = new WebSocketServer({ server }); // shares TLS port
const rooms = new Map(); // roomId -> Set<WebSocket>

wss.on("connection", (ws) => {
  // debugging
  console.log('ws:', ws)
  let roomId = null;

  //debugging
  console.log("connection")

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === "join") {
        roomId = msg.roomId;
        if (!rooms.has(roomId)) rooms.set(roomId, new Set());

        // debugging
        console.log("rooms map:", rooms)

        // notify existing peers that someone joined
        for (const peer of rooms.get(roomId)) {
          if (peer !== ws && peer.readyState === 1) {
            peer.send(JSON.stringify({ type: "peer-joined" }));
          }
        }

        rooms.get(roomId).add(ws);

        // notify the new peer that others are already in the room
        if (rooms.get(roomId).size > 1) {
          ws.send(JSON.stringify({ type: "peer-joined" }));
        }

        return;
      }

      //debugging
      console.log('WS IN', roomId, msg.type, Object.keys(msg.payload || {}));

      if (msg.type === "signal" && roomId && rooms.has(roomId)) {
        for (const peer of rooms.get(roomId)) {
          if (peer !== ws && peer.readyState === 1) {
            peer.send(JSON.stringify({ type: "signal", payload: msg.payload }));
          }
        }
      }
    } catch (e) {
      console.error("WS message error:", e);
    }
  });

  ws.on("close", () => {
    if (roomId && rooms.has(roomId)) {
      rooms.get(roomId).delete(ws);
      if (rooms.get(roomId).size === 0) rooms.delete(roomId);
    }
  });
});
