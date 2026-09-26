param([string]$Root, [int]$Port = 8767)
$l = New-Object System.Net.HttpListener
$l.Prefixes.Add("http://localhost:$Port/")
$l.Start()
$types = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.png'='image/png'; '.css'='text/css; charset=utf-8'; '.webmanifest'='application/manifest+json'; '.svg'='image/svg+xml' }
$rootFull = [IO.Path]::GetFullPath($Root)
while ($l.IsListening) {
  $c = $l.GetContext()
  $p = [Uri]::UnescapeDataString($c.Request.Url.AbsolutePath.TrimStart('/'))
  if ($p -eq '') { $p = 'index.html' }
  $f = [IO.Path]::GetFullPath((Join-Path $Root $p))
  if (-not $f.StartsWith($rootFull)) { $c.Response.StatusCode = 403; $c.Response.Close(); continue }
  # dev only: POST /icons/*.png saves the request body (used to export canvas-drawn icons)
  if ($c.Request.HttpMethod -eq 'POST' -and $p -like 'icons/*.png') {
    New-Item -ItemType Directory -Force (Split-Path $f) | Out-Null
    $ms = New-Object IO.MemoryStream
    $c.Request.InputStream.CopyTo($ms)
    [IO.File]::WriteAllBytes($f, $ms.ToArray())
    $c.Response.StatusCode = 201
  } elseif (Test-Path $f -PathType Leaf) {
    $b = [IO.File]::ReadAllBytes($f)
    $ext = [IO.Path]::GetExtension($f)
    if ($types.ContainsKey($ext)) { $c.Response.ContentType = $types[$ext] }
    $c.Response.Headers.Add('Cache-Control', 'no-cache')
    $c.Response.OutputStream.Write($b, 0, $b.Length)
  } else { $c.Response.StatusCode = 404 }
  $c.Response.Close()
}
