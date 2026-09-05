param([int]$ExitCode = 0)

$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Write-Output "READY:Tiếng Việt:界:😀"
$splitBytes = [System.Text.Encoding]::UTF8.GetBytes("SPLIT:Tiếng Việt:界:😀`r`n")
$stdout = [Console]::OpenStandardOutput()
$stdout.Write($splitBytes, 0, 9)
$stdout.Flush()
Start-Sleep -Milliseconds 10
$stdout.Write($splitBytes, 9, $splitBytes.Length - 9)
$stdout.Flush()
1..64 | ForEach-Object { Write-Output "BURST:$_" }
$line = [Console]::ReadLine()
Write-Output "ECHO:$line"
Write-Output "INPUT-BYTES:$([System.Text.Encoding]::UTF8.GetByteCount($line))"
Write-Output "SIZE:$([Console]::WindowWidth)x$([Console]::WindowHeight)"
exit $ExitCode
