<?php

require __DIR__ . '/vendor/autoload.php';

use Dotenv\Dotenv;
use PHPMailer\PHPMailer\Exception;
use PHPMailer\PHPMailer\PHPMailer;

$dotenv = Dotenv::createImmutable(__DIR__);
$dotenv->safeLoad();

function envOrFail(string $key): string
{
    $value = $_ENV[$key] ?? $_SERVER[$key] ?? '';
    if ($value === '') {
        throw new RuntimeException("Missing env variable: {$key}");
    }
    return $value;
}

try {
    $mail = new PHPMailer(true);

    $mail->isSMTP();
    $mail->Host = envOrFail('SMTP_HOST');
    $mail->Port = (int) envOrFail('SMTP_PORT');
    $mail->SMTPAuth = true;
    $mail->Username = envOrFail('SMTP_USERNAME');
    $mail->Password = envOrFail('SMTP_PASSWORD');
    $mail->SMTPSecure = envOrFail('SMTP_SECURE');

    $mail->Encoding = 'base64';
    $mail->isHTML(true);
    $mail->CharSet = 'UTF-8';
    $mail->SMTPDebug = (int) ($_ENV['SMTP_DEBUG'] ?? 0);

    $mail->setFrom(envOrFail('MAIL_FROM'));
    $mail->addAddress(envOrFail('MAIL_TO'));
    $mail->Subject = $_ENV['MAIL_SUBJECT'] ?? 'Test Email';
    $mail->Body = $_ENV['MAIL_BODY'] ?? 'Test email sent successfully.';

    $mail->send();
    echo 'Successfully sent';
} catch (Exception $e) {
    echo 'Mail sending failed: ' . $mail->ErrorInfo;
} catch (Throwable $e) {
    echo 'Configuration error: ' . $e->getMessage();
}
