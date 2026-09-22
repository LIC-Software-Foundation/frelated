import type WebSocket from 'ws';

export type CollaborationAccess = 'none' | 'viewer' | 'editor';

export interface CollaborationConnection {
  ws: WebSocket;
  email: string;
  principalKind: 'user' | 'guest';
  principalId: string;
  projectId: string;
  access: Exclude<CollaborationAccess, 'none'>;
}

export interface RoomData {
  createdAt: Date;
  connectionCount: number;
  lastActivity: Date;
}
