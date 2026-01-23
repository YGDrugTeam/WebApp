param(
  [string]$BaseUrl = "http://localhost:8000"
)

$ErrorActionPreference = "Stop"

Write-Host "Checking backend voice endpoints at $BaseUrl" -ForegroundColor Cyan

# 1) Status endpoints
$ttsStatus = Invoke-RestMethod -Uri "$BaseUrl/tts/status" -Method Get
$sttStatus = Invoke-RestMethod -Uri "$BaseUrl/stt/status" -Method Get
$probe = $null
try {
  $probe = Invoke-RestMethod -Uri "$BaseUrl/tts/probe" -Method Get
} catch {
  $probe = @{ ok = $false; error = $_.Exception.Message }
}

Write-Host "\n/tts/status:" -ForegroundColor Yellow
$ttsStatus | ConvertTo-Json -Depth 6

Write-Host "\n/stt/status:" -ForegroundColor Yellow
$sttStatus | ConvertTo-Json -Depth 6

Write-Host "\n/tts/probe:" -ForegroundColor Yellow
$probe | ConvertTo-Json -Depth 6

# 2) Generate a short TTS mp3 to a temp file
$payload = @{ text = "안녕하세요. 필세이프 AI 음성 테스트입니다."; gender = "male" } | ConvertTo-Json
$outFile = Join-Path $env:TEMP "pill-safe-tts-test.mp3"

Write-Host "\nRequesting /tts (male) -> $outFile" -ForegroundColor Yellow
try {
  Invoke-RestMethod -Uri "$BaseUrl/tts" -Method Post -ContentType "application/json" -Body $payload -OutFile $outFile
} catch {
  Write-Host "TTS request failed:" -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  throw
}

$size = (Get-Item $outFile).Length
Write-Host "Saved: $outFile ($size bytes)" -ForegroundColor Green

Write-Host "\nIf the file size is 0 or you get 502, check your Azure env and backend logs." -ForegroundColor DarkYellow
