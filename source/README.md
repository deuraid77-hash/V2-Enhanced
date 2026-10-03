# Living Los Santos 3 — source workspace

This workspace contains the rebuilt live portal, local Express companion and C# GTA V Enhanced world director. Start with the package-level `../README.md` and `../WORLD-REBUILD.md` for play, installation and rollback. `WORLD-PROTOCOL.md` defines the shared wire contract; `game-client/README.md` documents actual game behavior and limits.

The production portal uses `/api/world`, server-sent events, revisioned director settings and session-bound commands. The old browser simulations are preserved only as unused source references; they are not reachable from the rebuilt portal. The current five panels report observed game state and acknowledged changes.

## Build and verify

Requires Node.js 22.12 or newer, plus the installed Enhanced ScriptHookVDotNet3 API and Windows .NET Framework 4.8 compiler for the game DLL.

```powershell
npm ci
npm run typecheck
npm test
npm run build
./game-client/Build-EnhancedClient.ps1
./game-client/Test-EnhancedClient.ps1
./game-client/Audit-EnhancedClient.ps1
```

The API audit's optional `-CecilPath` points to a local Mono.Cecil assembly used only for analysis; it is not a runtime dependency. The game client's compiled HTTP probe is built with `game-client/Build-WorldProbe.ps1` and runs only on isolated QA ports 3101–3199. QA data must never be posted into the production world session.

Run `npm start` for the production companion after building, or use the package's launcher. The server binds only 127.0.0.1:3000. The private Gemini key is read on the server from the existing local configuration. No key belongs in frontend code, a game DLL or a public environment variable.

Director settings and command receipts are stored under the ignored `data` directory. The game's campaign lives under `%LOCALAPPDATA%\LivingLosSantos\Enhanced`. The legacy voice bridge on 8765 remains separate; it is not the transport for this director.
