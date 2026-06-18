# ============================================================
# EMAIL VALIDATOR - TALENTWALE
# Domain: talentwale.com
# Method: Syntax + MX Record + SMTP (Yahoo = Pattern check)
# ============================================================

param(
    [string]$InputFile  = "emails.txt",
    [string]$OutputFile = "results.csv",
    [string]$FromEmail  = "hello@talentwale.com",
    [string]$FromDomain = "talentwale.com",
    [int]$TimeoutMs     = 5000,
    [int]$DelayMs       = 300
)

# ---- SYNTAX CHECK ----
function Test-EmailSyntax {
    param([string]$email)
    return $email -match '^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$'
}

# ---- MX RECORD CHECK ----
function Get-MXRecord {
    param([string]$domain)
    try {
        $res = Resolve-DnsName -Name $domain -Type MX -ErrorAction Stop 2>$null
        $mx  = ($res | Where-Object { $_.Type -eq "MX" } | Sort-Object Preference | Select-Object -First 1).NameExchange
        return $mx
    } catch { return $null }
}

# ---- SMTP VERIFICATION ----
function Test-SMTPVerification {
    param(
        [string]$email,
        [string]$mxServer,
        [string]$fromEmail,
        [string]$fromDomain,
        [int]$timeout
    )

    $result = @{ Connected=$false; SmtpCode=0; SmtpMsg=""; Valid=$false }

    try {
        $tcp  = New-Object System.Net.Sockets.TcpClient
        $conn = $tcp.BeginConnect($mxServer, 25, $null, $null)
        $wait = $conn.AsyncWaitHandle.WaitOne($timeout, $false)

        if (-not $wait) { $tcp.Close(); $result.SmtpMsg = "Timeout"; return $result }

        $tcp.EndConnect($conn)
        $result.Connected = $true

        $stream               = $tcp.GetStream()
        $stream.ReadTimeout   = $timeout
        $stream.WriteTimeout  = $timeout
        $reader               = New-Object System.IO.StreamReader($stream)
        $writer               = New-Object System.IO.StreamWriter($stream)
        $writer.AutoFlush     = $true

        $banner = $reader.ReadLine()
        if ($banner -notmatch '^220') { throw "Bad banner: $banner" }

        $writer.WriteLine("HELO $fromDomain")
        $null = $reader.ReadLine()

        $writer.WriteLine("MAIL FROM:<$fromEmail>")
        $null = $reader.ReadLine()

        $writer.WriteLine("RCPT TO:<$email>")
        $rcptResp = $reader.ReadLine()

        Start-Sleep -Milliseconds 200
        while ($stream.DataAvailable) { $rcptResp = $reader.ReadLine() }

        if ($rcptResp -match '^(\d{3})') {
            $result.SmtpCode = [int]$matches[1]
            $result.SmtpMsg  = $rcptResp.Trim()
            if ($result.SmtpCode -in @(250,251,452)) { $result.Valid = $true }
        }

        $writer.WriteLine("QUIT")
        $tcp.Close()

    } catch {
        $result.SmtpMsg = $_.Exception.Message.Substring(0, [Math]::Min(80, $_.Exception.Message.Length))
    }

    return $result
}

# ---- MAIN VALIDATE FUNCTION ----
function Validate-Email {
    param([string]$email)

    # Convert spaces/nulls just in case and trim
    $email = $email.Trim().ToLower()

    $row = [PSCustomObject]@{
        Email     = $email
        Status    = "UNKNOWN"
        Reason    = ""
        MX_Server = ""
        SMTP_Code = ""
        SMTP_Msg  = ""
    }

    # 1. Syntax check
    if (-not (Test-EmailSyntax $email)) {
        $row.Status = "INVALID"; $row.Reason = "Bad syntax"; return $row
    }

    $parts  = $email -split '@'
    $user   = $parts[0]
    $domain = $parts[1]

    # 2. Gmail Only Policy Check
    if ($domain -ne "gmail.com") {
        $row.Status = "INVALID"; $row.Reason = "Rejected by policy: only gmail.com allowed"; return $row
    }

    # 3. MX Record check
    $mx = Get-MXRecord -domain $domain
    if (-not $mx) {
        $row.Status = "INVALID"; $row.Reason = "No MX record - domain cannot receive email"; return $row
    }
    $row.MX_Server = $mx

    # 4. SMTP Verification for Gmail
    $smtp = Test-SMTPVerification -email $email -mxServer $mx -fromEmail $FromEmail -fromDomain $FromDomain -timeout $TimeoutMs
    $row.SMTP_Code = $smtp.SmtpCode
    $row.SMTP_Msg  = $smtp.SmtpMsg

    if (-not $smtp.Connected) {
        $row.Status = "RISKY"; $row.Reason = "Port 25 blocked. MX exists. Cannot verify."
        return $row
    }

    if ($smtp.Valid) {
        if ($smtp.SmtpCode -eq 452) {
            $row.Status = "VALID"; $row.Reason = "Mailbox full but user exists (452)"
        } else {
            $row.Status = "VALID"; $row.Reason = "SMTP confirmed valid (RCPT TO 250 OK)"
        }
    } elseif ($smtp.SmtpCode -in @(550,551,553,554)) {
        $row.Status = "INVALID"; $row.Reason = "SMTP rejected - User does not exist ($($smtp.SmtpCode))"
    } else {
        $row.Status = "RISKY"; $row.Reason = "SMTP code $($smtp.SmtpCode): $($smtp.SmtpMsg)"
    }

    return $row
}

# ================================================================
# EXECUTION
# ================================================================

Write-Host ""
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "   TALENTWALE EMAIL VALIDATOR v2.1" -ForegroundColor Cyan
Write-Host "   Domain Protection Tool" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $InputFile)) {
    Write-Host "File not found: $InputFile" -ForegroundColor Red
    Write-Host ""
    Write-Host "Creating sample emails.txt ..." -ForegroundColor Yellow

    $sample = "gyanusingh841@gmail.com`r`ntest@yahoo.com`r`nfakeuser99999abc@yahoo.com`r`nhello@talentwale.com`r`nnotexist@notadomain12345x.com`r`nabc@mailinator.com`r`nuser@outlook.com"
    [System.IO.File]::WriteAllText("emails.txt", $sample, [System.Text.Encoding]::UTF8)

    Write-Host "Sample file created! Run script again: .\email-validator.ps1" -ForegroundColor Green
    exit
}

# MODIFIED: Removed -Encoding UTF8 to fix reading files created with Out-File/echo
$emails  = Get-Content $InputFile | Where-Object { $_.Trim() -ne "" } | ForEach-Object { $_ -replace "`0", "" }
$total   = $emails.Count
$results = @()
$counter = 0
$validCount   = 0
$invalidCount = 0
$riskyCount   = 0

Write-Host "Total emails: $total" -ForegroundColor White
Write-Host "Output file : $OutputFile" -ForegroundColor White
Write-Host ""
Write-Host "-------------------------------------------------"

foreach ($email in $emails) {
    $counter++
    Write-Host -NoNewline "[$counter/$total] $email ... "

    $result   = Validate-Email -email $email
    $results += $result

    switch ($result.Status) {
        "VALID"   { Write-Host "[VALID]   $($result.Reason)"   -ForegroundColor Green;  $validCount++   }
        "INVALID" { Write-Host "[INVALID] $($result.Reason)"   -ForegroundColor Red;    $invalidCount++ }
        "RISKY"   { Write-Host "[RISKY]   $($result.Reason)"   -ForegroundColor Yellow; $riskyCount++   }
        default   { Write-Host "[UNKNOWN] $($result.Reason)"   -ForegroundColor Gray }
    }

    if ($counter -lt $total) { Start-Sleep -Milliseconds $DelayMs }
}

Write-Host "-------------------------------------------------"
Write-Host ""
Write-Host "=== FINAL REPORT ===" -ForegroundColor Cyan
Write-Host "  VALID   : $validCount"   -ForegroundColor Green
Write-Host "  INVALID : $invalidCount" -ForegroundColor Red
Write-Host "  RISKY   : $riskyCount"   -ForegroundColor Yellow
Write-Host "  TOTAL   : $total"        -ForegroundColor White
Write-Host ""

# Export CSV
$results | Export-Csv -Path $OutputFile -NoTypeInformation -Encoding UTF8
Write-Host "Saved: $OutputFile" -ForegroundColor Green

# Separate text files
$results | Where-Object { $_.Status -eq "VALID"   } | Select-Object -ExpandProperty Email | Set-Content "valid_emails.txt"   -Encoding UTF8
$results | Where-Object { $_.Status -eq "INVALID" } | Select-Object -ExpandProperty Email | Set-Content "invalid_emails.txt" -Encoding UTF8
$results | Where-Object { $_.Status -eq "RISKY"   } | Select-Object -ExpandProperty Email | Set-Content "risky_emails.txt"   -Encoding UTF8

Write-Host ""
Write-Host "Files created:" -ForegroundColor Cyan
Write-Host "  valid_emails.txt   - Send these safely"      -ForegroundColor Green
Write-Host "  risky_emails.txt   - Send with caution" -ForegroundColor Yellow
Write-Host "  invalid_emails.txt - Remove from list"       -ForegroundColor Red
Write-Host ""
