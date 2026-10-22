# יוצר את icon.ico (ריבוע כתום מעוגל עם סמל הפעלה לבן), בגדלים 16 עד 256.
param([string]$Out = (Join-Path $PSScriptRoot 'icon.ico'))
Add-Type -AssemblyName System.Drawing
$sizes = 16, 24, 32, 48, 64, 128, 256
$pngs = foreach ($s in $sizes) {
  $bmp = New-Object Drawing.Bitmap $s, $s
  $g = [Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $r = [Math]::Max(2, [int]($s * 0.22))
  $path = New-Object Drawing.Drawing2D.GraphicsPath
  $path.AddArc(0, 0, $r * 2, $r * 2, 180, 90); $path.AddArc($s - $r * 2 - 1, 0, $r * 2, $r * 2, 270, 90)
  $path.AddArc($s - $r * 2 - 1, $s - $r * 2 - 1, $r * 2, $r * 2, 0, 90); $path.AddArc(0, $s - $r * 2 - 1, $r * 2, $r * 2, 90, 90)
  $path.CloseFigure()
  $g.FillPath((New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(196, 99, 45))), $path)
  $pen = New-Object Drawing.Pen ([Drawing.Color]::White), ([Math]::Max(1.5, $s * 0.095))
  $pen.StartCap = 'Round'; $pen.EndCap = 'Round'
  $c = $s / 2; $rad = $s * 0.27
  $g.DrawArc($pen, [float]($c - $rad), [float]($c - $rad + $s * 0.04), [float]($rad * 2), [float]($rad * 2), -50, 280)
  $g.DrawLine($pen, [float]$c, [float]($s * 0.18), [float]$c, [float]($s * 0.47))
  $g.Dispose()
  $ms = New-Object IO.MemoryStream
  $bmp.Save($ms, [Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
  , $ms.ToArray()
}
$fs = [IO.File]::Create($Out); $w = New-Object IO.BinaryWriter $fs
$w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $s = $sizes[$i]; $d = $pngs[$i]
  $w.Write([byte]($(if ($s -ge 256) { 0 } else { $s }))); $w.Write([byte]($(if ($s -ge 256) { 0 } else { $s })))
  $w.Write([byte]0); $w.Write([byte]0); $w.Write([UInt16]1); $w.Write([UInt16]32)
  $w.Write([UInt32]$d.Length); $w.Write([UInt32]$offset); $offset += $d.Length
}
foreach ($d in $pngs) { $w.Write($d) }
$w.Close()
Write-Host "icon: $Out"
