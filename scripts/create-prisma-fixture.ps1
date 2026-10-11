# Offline synthetic fixture helper. Run with Windows PowerShell (powershell.exe).
# No provider calls, learner recording, or Timbre usage. Output is local synthetic test speech.
param(
  [ValidateSet('BASELINE', 'SHORT', 'SEGMENTATION', 'HINGLISH', 'COMBINED')]
  [string]$Probe = 'BASELINE',
  [ValidateSet('haan', 'nahi', 'rukko', 'one second', 'okay', 'verify karunga',
    'Main official number par call karke verify karunga.', 'DUMMY-4821')]
  [string]$Phrase = 'one second',
  [ValidateSet(8000, 16000, 44100, 48000)] [int]$SampleRateHz = 16000,
  [string]$OutputDirectory = (Join-Path ([System.IO.Path]::GetTempPath()) ('prisma-synthetic-' + [guid]::NewGuid().ToString('N')))
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$taskSynth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$taskStream = New-Object System.IO.MemoryStream
try {
  # Preserve BASELINE's original single-phrase output. Other modes use fixed reviewed composites.
  $taskPhrases = @($Phrase)
  $taskPausesMs = @()
  switch ($Probe) {
    'SHORT' { $taskPhrases = @('okay', 'one second'); $taskPausesMs = @(1200) }
    'SEGMENTATION' { $taskPhrases = @('okay', 'one second', 'okay'); $taskPausesMs = @(200, 1200) }
    'COMBINED' { $taskPhrases = @('okay', 'haan', 'one second'); $taskPausesMs = @(1200, 200) }
    'HINGLISH' {
      $taskPhrases = @('haan one second')
      $taskHindiVoice = $taskSynth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -like 'hi-*' } | Select-Object -First 1
      if ($taskHindiVoice) { $taskSynth.SelectVoice($taskHindiVoice.VoiceInfo.Name) }
    }
  }
  $taskFormat = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo -ArgumentList $SampleRateHz, ([System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen), ([System.Speech.AudioFormat.AudioChannel]::Mono)
  $taskParts = @()
  for ($taskPhraseIndex = 0; $taskPhraseIndex -lt $taskPhrases.Count; $taskPhraseIndex++) {
    if ($taskPhraseIndex -gt 0) {
      $taskSilence = New-Object byte[] ([int]($SampleRateHz * 2 * $taskPausesMs[$taskPhraseIndex - 1] / 1000))
      $taskStream.Write($taskSilence, 0, $taskSilence.Length)
    }
    $taskPartStream = New-Object System.IO.MemoryStream
    try {
      $taskSynth.SetOutputToAudioStream($taskPartStream, $taskFormat)
      $taskSynth.Speak($taskPhrases[$taskPhraseIndex])
      $taskPartBytes = $taskPartStream.ToArray()
      $taskSynth.SetOutputToNull()
    } finally { $taskPartStream.Dispose() }
    $taskStartByte = 0
    $taskEndByte = $taskPartBytes.Length
    if ($Probe -ne 'BASELINE') {
      # Remove only exact zero padding; then insert measured zero-PCM pauses.
      while ($taskStartByte -lt $taskEndByte -and [System.BitConverter]::ToInt16($taskPartBytes, $taskStartByte) -eq 0) { $taskStartByte += 2 }
      while ($taskEndByte -gt $taskStartByte -and [System.BitConverter]::ToInt16($taskPartBytes, $taskEndByte - 2) -eq 0) { $taskEndByte -= 2 }
    }
    if ($taskEndByte -le $taskStartByte) { throw 'Synthetic speech contains no nonzero PCM samples.' }
    $taskPartStart = [int]($taskStream.Length / 2)
    $taskStream.Write($taskPartBytes, $taskStartByte, ($taskEndByte - $taskStartByte))
    $taskParts += [ordered]@{ phrase = $taskPhrases[$taskPhraseIndex]; startSample = $taskPartStart; endSample = [int]($taskStream.Length / 2) }
  }
  $taskBytes = $taskStream.ToArray()
  if ($taskBytes.Length -eq 0 -or $taskBytes.Length % 2 -ne 0 -or $taskBytes.Length -gt $SampleRateHz * 2 * 8) {
    throw 'Generated fixture must contain at most eight seconds of PCM16 speech.'
  }
  $taskResolvedDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
  New-Item -ItemType Directory -Path $taskResolvedDirectory -Force | Out-Null
  $taskAudioPath = Join-Path $taskResolvedDirectory 'fixture.pcm'
  [System.IO.File]::WriteAllBytes($taskAudioPath, $taskBytes)
  $taskHash = (Get-FileHash -LiteralPath $taskAudioPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $taskManifest = [ordered]@{
    source = 'synthetic-local-speech'; encoding = 'PCM_S16LE'; channels = 1
    sampleRateHz = $SampleRateHz; audioFile = 'fixture.pcm'; expectedText = ($taskPhrases -join ' '); sha256 = $taskHash
    probe = $Probe; parts = @($taskParts)
    voiceName = $taskSynth.Voice.Name; voiceCulture = $taskSynth.Voice.Culture.Name
  }
  $taskManifestPath = Join-Path $taskResolvedDirectory 'manifest.json'
  [System.IO.File]::WriteAllText($taskManifestPath, ($taskManifest | ConvertTo-Json), (New-Object System.Text.UTF8Encoding($false)))
  Write-Output $taskManifestPath
} finally {
  $taskSynth.Dispose()
  $taskStream.Dispose()
}
