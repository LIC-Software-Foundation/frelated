/**
 * Minimal Y.js WebSocket Server for Collaborative Editing
 * Logs the current content of the shared document in each room
 */

import http, { IncomingMessage, ServerResponse } from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import { setupWSConnection } from 'y-websocket/bin/utils';

const PORT: number = Number(process.env.PORT) || 8080;
const HOST: string = process.env.HOST || 'localhost';

// Create HTTP server
const server = http.createServer(
  (_request: IncomingMessage, response: ServerResponse) => {
    response.writeHead(200, { 'Content-Type': 'text/plain' });
    response.end('Y.js WebSocket Server is running\n');
  },
);

// Create WebSocket server
const wss = new WebSocketServer({
  server,
  verifyClient: (info) => {
    console.log(
      `[INFO] [${new Date().toISOString()}] WebSocket connection attempt from: ${info.origin}`,
    );
    return true;
  },
});

// Types for room tracking
interface RoomData {
  createdAt: Date;
  connectionCount: number;
  lastActivity: Date;
}

// Track active rooms and connections
const activeRooms: Map<string, RoomData> = new Map();
const connectionStats = {
  totalConnections: 0,
  activeConnections: 0,
  roomsCreated: 0,
};

// Store Yjs documents
const docs: Map<string, Y.Doc> = new Map();

function getYDoc(roomName: string): Y.Doc {
  let doc = docs.get(roomName);
  if (!doc) {
    doc = new Y.Doc();
    docs.set(roomName, doc);

    // Observe changes on the shared text
    const ytext = doc.getText('codemirror');
    console.log(
      `[INFO] [${roomName}] Initial content:\n${ytext.toString()}\n---`,
    );
    ytext.observe(() => {
      console.log(
        `[INFO] [${roomName}] Current content:\n${ytext.toString()}\n---`,
      );
    });
  }
  return doc;
}

// Handle WebSocket connections
wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
  connectionStats.totalConnections++;
  connectionStats.activeConnections++;

  const url = req.url;
  const roomName = url ? url.slice(1) : 'default';

  console.log(
    `[INFO] [${new Date().toISOString()}] New client connected to room: "${roomName}"`,
  );
  console.log(
    `[INFO] [${new Date().toISOString()}] Stats: ${connectionStats.activeConnections} active connections, ${activeRooms.size} rooms`,
  );

  // Track room activity
  if (!activeRooms.has(roomName)) {
    activeRooms.set(roomName, {
      createdAt: new Date(),
      connectionCount: 0,
      lastActivity: new Date(),
    });
    connectionStats.roomsCreated++;
    console.log(
      `[INFO] [${new Date().toISOString()}] Room "${roomName}" created`,
    );
  }

  const roomData = activeRooms.get(roomName)!;
  roomData.connectionCount++;
  roomData.lastActivity = new Date();

  // Get (or create) the Y.Doc for this room
  getYDoc(roomName);

  // Setup Y.js WebSocket connection
  setupWSConnection(ws, req, {
    docMap: docs,
    gc: true,
  });

  // Handle client disconnect
  ws.on('close', () => {
    connectionStats.activeConnections--;

    const roomData = activeRooms.get(roomName);
    if (roomData) {
      roomData.connectionCount--;

      if (roomData.connectionCount <= 0) {
        // attendre 5 secondes avant de fermer définitivement
        setTimeout(() => {
          const current = activeRooms.get(roomName);
          if (current && current.connectionCount <= 0) {
            activeRooms.delete(roomName);
            console.log(
              `[INFO] Room "${roomName}" closed (no active connections)`,
            );
          }
        }, 5000);
      }
    }

    console.log(`[INFO] 👋 Client disconnected from room: "${roomName}"`);
  });

  ws.on('error', (error) => {
    console.error(
      `[INFO] [${new Date().toISOString()}] WebSocket error in room "${roomName}":`,
      error,
    );
  });
});

// Handle WebSocket server errors
wss.on('error', (error) => {
  console.error(
    `[INFO] [${new Date().toISOString()}] WebSocket server error:`,
    error,
  );
});

// Start the server
server.listen(PORT, HOST, () => {
  console.log(
    `[INFO] [${new Date().toISOString()}] Y.js WebSocket server running on ws://${HOST}:${PORT}`,
  );
  console.log(
    `[INFO] [${new Date().toISOString()}] Ready for collaborative editing sessions`,
  );
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log(
    `[INFO] \n[${new Date().toISOString()}] Shutting down server gracefully...`,
  );
  console.log(`[INFO] [${new Date().toISOString()}] Final stats:`);
  console.log(
    `   - Total connections served: ${connectionStats.totalConnections}`,
  );
  console.log(`   - Rooms created: ${connectionStats.roomsCreated}`);
  console.log(`   - Active rooms at shutdown: ${activeRooms.size}`);

  wss.close(() => {
    console.log(
      `[INFO] [${new Date().toISOString()}] Server shut down successfully`,
    );
    process.exit(0);
  });
});

// Log server stats every 5 minutes
setInterval(
  () => {
    if (connectionStats.activeConnections > 0 || activeRooms.size > 0) {
      console.log(`[INFO] [${new Date().toISOString()}] Server status:`);
      console.log(
        `   - Active connections: ${connectionStats.activeConnections}`,
      );
      console.log(`   - Active rooms: ${activeRooms.size}`);
      console.log(
        `   - Total connections served: ${connectionStats.totalConnections}`,
      );

      if (activeRooms.size > 0) {
        console.log(`   - Active rooms details:`);
        activeRooms.forEach((data, roomName) => {
          console.log(
            `     * "${roomName}": ${data.connectionCount} connections, last active ${data.lastActivity.toISOString()}`,
          );
        });
      }
    }
  },
  5 * 60 * 1000,
);

export default server;
