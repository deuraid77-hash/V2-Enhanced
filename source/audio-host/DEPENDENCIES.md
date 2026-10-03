# Capture helper dependency record

VERIFIED on 2026-10-03. These libraries belong exclusively to the external companion helper. No NAudio library or microphone/focus P/Invoke is loaded into the GTA script DLL.

| Package | Version | SHA-256 of original NuGet package | Licence |
|---|---|---|---|
| NAudio.Core | 2.4.0 | 63EC0488354353F035764E2CAE470B04AFB790B0E5A9706ED1987B9AF3CFE02F | MIT |
| NAudio.Wasapi | 2.4.0 | AEC112D586ADF06C467F444AEC745BDE4932D7B44D77B393634FE5EA09E20B12 | MIT |

Official package URLs:
- https://api.nuget.org/v3-flatcontainer/naudio.core/2.4.0/naudio.core.2.4.0.nupkg
- https://api.nuget.org/v3-flatcontainer/naudio.wasapi/2.4.0/naudio.wasapi.2.4.0.nupkg

Both package manifests name author Mark Heath, MIT licence, and repository commit `7c855e6737435f781dcbac782930a0de7a13cb2b`. The `netstandard2.0` libraries are compiled against the installed .NET Framework compiler and facade. The original packages and manifests are retained under `vendor`. The build copies only those two runtime DLLs next to the helper executable.

Maintainer source: https://github.com/naudio/NAudio/tree/7c855e6737435f781dcbac782930a0de7a13cb2b
Licence: https://github.com/naudio/NAudio/blob/7c855e6737435f781dcbac782930a0de7a13cb2b/license.txt

Documented Windows focus APIs, used only outside the game process:
- https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getforegroundwindow
- https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowthreadprocessid

`Build-AudioHost.ps1 -SelfTest` compiles the helper and runs synthetic PCM normalization and capture-policy checks. It never enumerates or opens a microphone during the self-test. Physical microphone operation remains a separate held-input acceptance check.

Transcription is pinned to `gemini-3.5-flash-lite`. Google's official pricing lists US$0.30 per million input tokens for text/image/video/audio and US$2.50 per million output tokens including thinking. Audio documentation specifies 32 audio input tokens/second. Reservations add 32 rounding tokens plus a conservative 2048 prompt/schema allowance and at most 1024 output tokens. Existing shared budget accounting can therefore use combined input counts without a different modality price. No base64 length is treated as text tokens.
- https://ai.google.dev/gemini-api/docs/pricing#gemini-3.5-flash-lite
- https://ai.google.dev/gemini-api/docs/audio

Account model listing and successful text calls do not prove microphone quality or audio request acceptance. A synthetic metered transcription probe and subsequent human held-input test establish those separately.
