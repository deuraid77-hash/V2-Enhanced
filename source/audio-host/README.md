# Companion audio host

**VERIFIED — foundation stage:** `Build-AudioHost.ps1 -SelfTest` compiles the standalone .NET Framework executable and runs 18 pure policy checks. The executable currently advertises `playback:false`, `capture:false`, `offlineSpeech:false`, and `spatialMixing:false`. No audio devices are opened by these checks. This is not an in-game audio acceptance result.

**VERIFIED — process boundary:** this directory has no reference to the GTA SDK and is not included in the game DLL project. `server-lib/audio-host.ts` starts it only when explicitly asked, without a shell and with `windowsHide:true`. It uses bounded newline-delimited JSON on private process pipes. EOF or `shutdown` ends the helper. The wrapper hides stderr and does not echo private text from errors. It has no API credentials or web listener.

**VERIFIED — offline policy:** `AudioPolicy.cs` tests equal-power stereo panning, distance falloff, maximum range, category priority, pause/death cancellation, stale position cancellation, runtime changes and scene changes. These are numerical tests, not proof of sound output, direction, audible latency, or the user's hardware.

**BELIEVED — implementation selected for the later audio gate:** pin NAudio Core/Wasapi 2.4.0 in this helper and use shared-mode WASAPI with a bounded stereo mixer. Render the Windows fallback through `System.Speech` into memory, then mix it through the same path as Gemini PCM. The installed .NET Framework compiler and netstandard facade can support these packages without installing another SDK. Full acquisition, binary validation, rendering and device tests remain part of the audio implementation gate.

**VERIFIED — dependency research, 2026-10-03:** NAudio 2.4.0 is MIT licensed and its Core and Wasapi modules target .NET Standard 2.0, compatible with .NET Framework 4.8. NAudio 3.1 requires a modern .NET target; no .NET SDK was installed during this research. Sources: [NAudio 2.4.0](https://www.nuget.org/packages/NAudio/2.4.0), [NAudio Core](https://www.nuget.org/packages/NAudio.Core/2.4.0), [NAudio Wasapi](https://packages.nuget.org/packages/NAudio.Wasapi/2.4.0), [maintainer repository](https://github.com/naudio/NAudio).

**VERIFIED — fallback inventory:** a read-only Windows `System.Speech` enumeration found Microsoft Hazel Desktop (en-GB, female) and Microsoft Zira Desktop (en-US, female). Neither synthesis nor playback was performed. The available voices must be enumerated again at runtime; gender and accent variety must not be invented. Microsoft's supported [WAV-stream synthesis API](https://learn.microsoft.com/en-us/dotnet/api/system.speech.synthesis.speechsynthesizer.setoutputtowavestream?view=netframework-4.8) can render without playing directly to the output device.

**VERIFIED — provider format research:** Google's [speech generation documentation](https://ai.google.dev/gemini-api/docs/speech-generation) supports streaming Gemini 3.8 speech through Interactions. The default streamed format is headerless signed 16-bit little-endian PCM, 24 kHz, mono; unary output defaults to WAV. `audio-types.ts` rejects a RIFF container in a PCM chunk. No paid call was used to verify account availability, latency or output quality.

**BELIEVED — spatial and lifecycle contract:** position packets will carry runtime ID, scene epoch, pause state, listener position and camera basis, and at most eight active speakers identified by stable NPC ID plus handle/modelHash. The default position update interval is 10 Hz, configurable to 20 Hz. A paused, dead, stale, replaced or invalid speaker must stop; changed scene/runtime invalidates queued and playing utterances. Selected conversation has higher priority than combat, then vehicle, then ambient speech. This is stereo spatialisation, not a claim of HRTF or GTA-native voice playback.

**VERIFIED — volume limitation:** the inspected GTA settings XML exposed `Audio3d`, but no game volume setting. Windows audio-session volume and mute are available through Microsoft's [IAudioSessionControl2](https://learn.microsoft.com/en-us/windows/win32/api/audiopolicy/nn-audiopolicy-iaudiosessioncontrol2) and [ISimpleAudioVolume](https://learn.microsoft.com/en-us/windows/win32/api/audioclient/nn-audioclient-isimpleaudiovolume). Tracking the game's internal sound slider is unverified. Any ducking must affect only the exact GTA process's audio session and restore owned changes without overwriting the user's subsequent volume changes.

**BELIEVED — audio acceptance gate:** measure cached and uncached first PCM / first device sample timings; distinguish those from human-perceived first audio. Exercise left/right and moving speakers, low-pass muffling, max-voice preemption, stale positions, pause/death/reload, companion EOF, device removal, capture start/stop, silence, microphone unplug, and duck-volume restoration. Capture begins only through explicit push-to-talk. No microphone recording belongs in ordinary logs or diagnostics.

## Foundation verification

```powershell
# From source
& .\audio-host\Build-AudioHost.ps1 -SelfTest
npx tsx --test test/audio-foundation.test.ts
```

**VERIFIED:** the second command tests voice-input bounds, signed PCM decoding and container rejection, inert construction, fragmented process messages, malformed replies, safe restart handling, bounded shutdown, executable-path validation and oversized request rejection. Its process is an in-memory test fixture; it does not play or record audio.

## Playback stage (Step 5, 2026-10-03)

**VERIFIED:** `Build-AudioHost.ps1 -SelfTest` builds `4.0.0-playback` with `/warnaserror+` and passes 44 checks (policy, capture, and the `PlaybackEngine` mixer: priority preemption with fade, same-NPC replacement, smoothed pan, stale-pose silencing, low-pass, PCM bounds). It opens 0 audio devices.
**VERIFIED:** `LivingLosSantos.AudioHost.exe --render-test` renders System.Speech to memory at 24 kHz/16-bit/mono: 124.2 ms cold for 2.77 s of audio, 68.6 ms warm for 3.40 s. No device was opened.
**BELIEVED (untested):** commands `playConfigure`, `play` (`source:file` restricted to `^[a-f0-9]{64}\.pcm$` inside `cacheRoot`, or `source:windows`), `playPositions`, `playStatus`, `playStop`, `playStopAll` and `windowsVoices` drive a lazily opened shared-mode WASAPI output (48 kHz float stereo, 60 ms). Shared-mode format conversion on the user's device is unverified. Device output, audibility and latency are user test-sheet items.
**BELIEVED:** Gemini TTS response handling follows the speech-generation guide (`interaction.output_audio.data`, base64 PCM). The provider rejects a RIFF/WAV payload. If unary output is WAV, as noted earlier in this file, Gemini voice would fall back to Windows speech. No paid call was made to settle this.
**Not implemented:** game-session ducking, following the game session volume, window-state muffling (not readable), facial animation, pitch shifting for Windows voices.
