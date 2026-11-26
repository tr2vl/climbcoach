# ClimbCoach's text reader: Windows' built-in OCR (Windows.Media.Ocr), nothing extra to install.
# Reads one image path per line on standard input and writes one JSON line per image:
# {"path": "...", "width": W, "height": H, "lines": [{"text": "...", "x": .., "y": .., "w": .., "h": ..}]}
# Boxes are normalised to 0..1 with the origin at the top left. Runs in Windows PowerShell 5.1.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Foundation, ContentType = WindowsRuntime]

$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]
function Await($operation, [Type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($operation))
  $task.Wait(-1) | Out-Null
  $task.Result
}

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new('en-US'))
if ($null -eq $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
if ($null -eq $engine) {
  @{ fatal = 'Windows has no text-recognition language installed. Add English in Settings > Time & language > Language.' } | ConvertTo-Json -Compress
  exit 1
}
@{ ready = $true; language = $engine.RecognizerLanguage.LanguageTag } | ConvertTo-Json -Compress

while ($null -ne ($path = [Console]::In.ReadLine())) {
  if ($path -eq '') { continue }
  try {
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    $w = [double]$bitmap.PixelWidth
    $h = [double]$bitmap.PixelHeight
    $lines = @()
    foreach ($line in $result.Lines) {
      $left = [double]::MaxValue; $top = [double]::MaxValue; $right = 0.0; $bottom = 0.0
      foreach ($word in $line.Words) {
        $r = $word.BoundingRect
        $left = [Math]::Min($left, $r.X); $top = [Math]::Min($top, $r.Y)
        $right = [Math]::Max($right, $r.X + $r.Width); $bottom = [Math]::Max($bottom, $r.Y + $r.Height)
      }
      $lines += @{ text = $line.Text; x = $left / $w; y = $top / $h; w = ($right - $left) / $w; h = ($bottom - $top) / $h }
    }
    $stream.Dispose()
    @{ path = $path; width = $w; height = $h; lines = $lines } | ConvertTo-Json -Compress -Depth 4
  } catch {
    @{ path = $path; error = $_.Exception.Message } | ConvertTo-Json -Compress
  }
}
