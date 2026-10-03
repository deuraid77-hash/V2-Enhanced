$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$evaluationDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\verification\npc-overhaul'))
New-Item -ItemType Directory -Path $evaluationDirectory -Force | Out-Null
$wavePath = Join-Path $evaluationDirectory 'synthetic-ptt.wav'
$manifestPath = Join-Path $evaluationDirectory 'synthetic-ptt.json'
if ((Test-Path -LiteralPath $wavePath) -or (Test-Path -LiteralPath $manifestPath)) { throw 'Synthetic evaluation already exists; preserve the evidence.' }
$phrase = 'Hello, I am looking for a quiet place to park near Grove Street.'
$voice = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
  $voice.SetOutputToWaveFile($wavePath, $format)
  $selectedVoice = $voice.Voice.Name
  $voice.Speak($phrase)
} finally { $voice.Dispose() }
$hash = (Get-FileHash -LiteralPath $wavePath -Algorithm SHA256).Hash.ToLowerInvariant()
$manifest = @{ classification='VERIFIED Windows synthesis to file only'; source='Windows System.Speech'; text=$phrase; voice=$selectedVoice; sha256=$hash; microphoneOpened=$false; speakerPlayback=$false; createdAt=[DateTime]::UtcNow.ToString('o') }
$manifest | ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding UTF8
[pscustomobject]$manifest | Select-Object classification, voice, sha256, microphoneOpened, speakerPlayback | ConvertTo-Json
