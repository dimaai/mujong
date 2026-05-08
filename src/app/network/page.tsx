// ============================================================
// src/app/network/page.tsx
//
// Thin Next.js App-Router page wrapper for the network lobby.
// All logic lives in `<NetworkLobby />`; this file exists only
// because Next routes off the filesystem.
// ============================================================

'use client';

import { NetworkLobby } from '../../components/NetworkLobby/NetworkLobby';

export default function NetworkPage() {
  return <NetworkLobby />;
}
