$server = "gmail-smtp-in.l.google.com"
$port = 25
$tcp = New-Object System.Net.Sockets.TcpClient($server, $port)
$stream = $tcp.GetStream()
$read = New-Object System.IO.StreamReader($stream)
$write = New-Object System.IO.StreamWriter($stream)
$write.AutoFlush = $true

Write-Output "--- CONNECTION INITIATED ---"
Write-Output "Google: $($read.ReadLine())"

Write-Output "`n--- STEP 1: SENDING HELO ---"
$write.WriteLine("HELO talentwale.com")
Write-Output "Google: $($read.ReadLine())"

Write-Output "`n--- STEP 2: SENDING SENDER IDENTITY ---"
$write.WriteLine("MAIL FROM:<hello@talentwale.com>")
Write-Output "Google: $($read.ReadLine())"

Write-Output "`n--- STEP 3: CHECKING YOUR ACTUAL EMAIL ---"
$write.WriteLine("RCPT TO:<gyanusingh841@gmail.com>")
Write-Output "Google: $($read.ReadLine())"

Write-Output "`n--- CLOSING CONNECTION ---"
$write.WriteLine("QUIT")
$tcp.Close()
Write-Output "Done!"
