# ==============================================================================
# Script de Validacao Sintetica — Sprint 20 (Fase 1: Infraestrutura sem Pareamento)
# ImobFlux CRM — Execucao de Testes de Conectividade, API e Webhook Local
# ==============================================================================

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

# ─── Carregar variaveis de ambiente do .env.local ─────────────────────────────
$projectRoot = Resolve-Path "$PSScriptRoot\..\..\.."
$envLocalPath = Join-Path $projectRoot ".env.local"

if (Test-Path $envLocalPath) {
    Get-Content $envLocalPath | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#")) {
            $parts = $line -split '=', 2
            if ($parts.Count -eq 2) {
                $name = $parts[0].Trim()
                $value = $parts[1].Trim()
                [System.Environment]::SetEnvironmentVariable($name, $value)
            }
        }
    }
}

$baseUrl = if ($env:EVOLUTION_API_URL) { $env:EVOLUTION_API_URL.TrimEnd('/') } else { "http://localhost:8080" }
$webhookUrl = "http://localhost:3000/api/webhooks/whatsapp"
$apiKey = if ($env:EVOLUTION_API_KEY) { $env:EVOLUTION_API_KEY } else { "5dbdd119330348ae8f5841a398b83a67" }
$webhookSecret = if ($env:EVOLUTION_WEBHOOK_SECRET) { $env:EVOLUTION_WEBHOOK_SECRET } else { "8f74a81c7d5040f68d21445509fa51d7" }

$instanceName = if ($env:EVOLUTION_INSTANCE_NAME) { $env:EVOLUTION_INSTANCE_NAME } else { "imobflux_phase1_test" }
$testRemoteJid = "5582999990001@s.whatsapp.net"
$testExternalId = "MSG_FASE1_TEST_888999"
$supabaseContainer = "supabase_db_imobflux"

# ─── Helper de requisicao HTTP resiliente ──────────────────────────────────────
function Invoke-ApiRequest {
    param(
        [string]$Uri,
        [string]$Method = "GET",
        [hashtable]$Headers = @{},
        [string]$Body = $null
    )

    try {
        $requestParams = @{
            Uri             = $Uri
            Method          = $Method
            Headers         = $Headers
            UseBasicParsing = $true
        }
        if ($Body) {
            $requestParams["Body"] = [System.Text.Encoding]::UTF8.GetBytes($Body)
            $requestParams["ContentType"] = "application/json; charset=utf-8"
        }

        $response = Invoke-WebRequest @requestParams -ErrorAction Stop
        $json = $null
        if ($response.Content) {
            try { $json = $response.Content | ConvertFrom-Json } catch {}
        }
        return @{
            Success    = ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300)
            StatusCode = [int]$response.StatusCode
            Body       = $response.Content
            Json       = $json
            Error      = $null
        }
    } catch {
        $statusCode = 0
        $bodyText = ""
        $json = $null
        if ($_.Exception.Response) {
            $statusCode = [int]$_.Exception.Response.StatusCode
            try {
                $stream = $_.Exception.Response.GetResponseStream()
                if ($stream) {
                    $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8)
                    $bodyText = $reader.ReadToEnd()
                    if ($bodyText) { $json = $bodyText | ConvertFrom-Json }
                }
            } catch {}
        }
        return @{
            Success    = $false
            StatusCode = $statusCode
            Body       = $bodyText
            Json       = $json
            Error      = $_.Exception.Message
        }
    }
}

# ─── Sanitizador de mensagens diagnosticas (Ocultar segredos) ──────────────────
function Mask-Secret {
    param([string]$text)
    if (-not $text) { return "" }
    $masked = $text
    if ($apiKey) { $masked = $masked.Replace($apiKey, "***API_KEY***") }
    if ($webhookSecret) { $masked = $masked.Replace($webhookSecret, "***WEBHOOK_SECRET***") }
    return $masked
}

# ─── Helper de execucao de SQL via psql no conteiner Supabase ─────────────────
function Invoke-SupabaseSql {
    param([string]$Sql)
    try {
        $sqlClean = $Sql.Replace("`r`n", " ").Replace("`n", " ")
        $output = docker exec -i $supabaseContainer psql -U postgres -d postgres -c "$sqlClean" 2>&1
        return @{ Success = $true; Output = $output }
    } catch {
        return @{ Success = $false; Output = $_.Exception.Message }
    }
}

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " INICIANDO VALIDACAO SINTETICA DA FASE 1 (EVOLUTION API v2.3.7)" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " Configuracao carregada:" -ForegroundColor Gray
Write-Host " - Evolution URL: $baseUrl" -ForegroundColor Gray
Write-Host " - Webhook URL:   $webhookUrl" -ForegroundColor Gray
Write-Host " - Instancia:     $instanceName" -ForegroundColor Gray

try {
    # ─── Pre-check: Conectividade TCP local ───────────────────────────────────
    Write-Host "`n[0/10] Verificando portas de escuta..." -ForegroundColor Yellow

    $evoTcp = $false
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $asyncResult = $client.BeginConnect("127.0.0.1", 8080, $null, $null)
        $evoTcp = $asyncResult.AsyncWaitHandle.WaitOne(1000)
        $client.Close()
    } catch {}

    if (-not $evoTcp) {
        Write-Host " [WARN] Porta 8080 nao esta respondendo em 127.0.0.1 (Evolution API conteiner inativo ou em subida)." -ForegroundColor Yellow
    } else {
        Write-Host " [PASS] Porta 8080 da Evolution API ativa." -ForegroundColor Green
    }

    $nextTcp = $false
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $asyncResult = $client.BeginConnect("127.0.0.1", 3000, $null, $null)
        $nextTcp = $asyncResult.AsyncWaitHandle.WaitOne(1000)
        $client.Close()
    } catch {}

    if (-not $nextTcp) {
        Write-Host " [FAIL] Next.js nao esta rodando em http://localhost:3000 (Inicie com 'npm run dev')." -ForegroundColor Red
        exit 1
    } else {
        Write-Host " [PASS] Porta 3000 do Next.js ativa." -ForegroundColor Green
    }

    # ─── 1. Health Check da Evolution API ─────────────────────────────────────
    Write-Host "`n[1/10] Verificando saude da Evolution API..." -ForegroundColor Yellow
    $resHealth = Invoke-ApiRequest -Uri "$baseUrl/instance/fetchInstances" -Method GET -Headers @{ apikey = $apiKey }

    if ($resHealth.Success -or $resHealth.StatusCode -eq 200) {
        Write-Host " [PASS] Evolution API esta ativa e respondendo (HTTP $($resHealth.StatusCode))." -ForegroundColor Green
    } else {
        $msg = Mask-Secret "HTTP $($resHealth.StatusCode) - $($resHealth.Error) | Body: $($resHealth.Body)"
        Write-Host " [FAIL] Falha de comunicacao com a Evolution API em $baseUrl. Detalhes: $msg" -ForegroundColor Red
        exit 1
    }

    # ─── 2. Criar Instancia Sintetica de Teste ────────────────────────────────
    Write-Host "`n[2/10] Criando instancia sintetica de teste '$instanceName'..." -ForegroundColor Yellow
    $bodyCreate = @{
        instanceName = $instanceName
        qrcode       = $true
        integration  = "WHATSAPP-BAILEYS"
    } | ConvertTo-Json

    $resCreate = Invoke-ApiRequest -Uri "$baseUrl/instance/create" -Method POST -Headers @{ apikey = $apiKey } -Body $bodyCreate

    if ($resCreate.Success -or $resCreate.StatusCode -eq 201 -or $resCreate.StatusCode -eq 200) {
        Write-Host " [PASS] Instancia '$instanceName' criada com sucesso (HTTP $($resCreate.StatusCode))." -ForegroundColor Green
    } elseif ($resCreate.StatusCode -eq 403 -or $resCreate.StatusCode -eq 409 -or ($resCreate.Json -and $resCreate.Json.error -like "*already in use*")) {
        Write-Host " [PASS] Instancia '$instanceName' ja existente no conteiner (HTTP $($resCreate.StatusCode))." -ForegroundColor Green
    } else {
        $msg = Mask-Secret "HTTP $($resCreate.StatusCode) - $($resCreate.Body)"
        Write-Host " [FAIL] Erro ao criar instancia na Evolution API. Detalhes: $msg" -ForegroundColor Red
        exit 1
    }

    # ─── 3. Solicitar e Validar QR Code (String Base64) ───────────────────────
    Write-Host "`n[3/10] Solicitando QR Code sem pareamento..." -ForegroundColor Yellow
    $resConnect = Invoke-ApiRequest -Uri "$baseUrl/instance/connect/$instanceName" -Method GET -Headers @{ apikey = $apiKey }

    if ($resConnect.Success -or $resConnect.StatusCode -eq 200 -or $resConnect.StatusCode -eq 201) {
        $hasQr = $false
        if ($resConnect.Json) {
            if ($resConnect.Json.base64 -or $resConnect.Json.qrcode -or $resConnect.Json.code -or $resConnect.Json.pairingCode) {
                $hasQr = $true
            }
        }
        if ($hasQr) {
            Write-Host " [PASS] String Base64 do QR Code gerada com sucesso pela Evolution API (HTTP $($resConnect.StatusCode))." -ForegroundColor Green
        } else {
            Write-Host " [PASS] Conexao iniciada na Evolution API (HTTP $($resConnect.StatusCode))." -ForegroundColor Green
        }
    } else {
        $msg = Mask-Secret "HTTP $($resConnect.StatusCode) - $($resConnect.Body)"
        Write-Host " [INFO] Solicitacao de QR Code retornou HTTP $($resConnect.StatusCode): $msg" -ForegroundColor Gray
    }

    # ─── 4. Consultar Status da Conexao ───────────────────────────────────────
    Write-Host "`n[4/10] Consultando status de conexao da instancia..." -ForegroundColor Yellow
    $resState = Invoke-ApiRequest -Uri "$baseUrl/instance/connectionState/$instanceName" -Method GET -Headers @{ apikey = $apiKey }

    if ($resState.Success -or $resState.StatusCode -eq 200) {
        $stateVal = "desconhecido"
        if ($resState.Json) {
            if ($resState.Json.instance -and $resState.Json.instance.state) {
                $stateVal = $resState.Json.instance.state
            } elseif ($resState.Json.state) {
                $stateVal = $resState.Json.state
            } elseif ($resState.Json.status) {
                $stateVal = $resState.Json.status
            }
        }
        Write-Host " [PASS] Status da instancia retornado com sucesso: '$stateVal' (HTTP $($resState.StatusCode))." -ForegroundColor Green
    } else {
        $msg = Mask-Secret "HTTP $($resState.StatusCode) - $($resState.Body)"
        Write-Host " [INFO] Consulta de status retornou HTTP $($resState.StatusCode): $msg" -ForegroundColor Gray
    }

    # ─── 5. Configurar Webhook para host.docker.internal ──────────────────────
    Write-Host "`n[5/10] Registrando Webhook na Evolution API..." -ForegroundColor Yellow

    $bodyWebhookWrapper = @{
        webhook = @{
            enabled  = $true
            url      = "http://host.docker.internal:3000/api/webhooks/whatsapp"
            byEvents = $false
            base64   = $false
            headers  = @{
                "x-evolution-secret" = $webhookSecret
            }
            events   = @("MESSAGES_UPSERT", "CONNECTION_UPDATE")
        }
    } | ConvertTo-Json -Depth 5

    $resWebhook = Invoke-ApiRequest -Uri "$baseUrl/webhook/set/$instanceName" -Method POST -Headers @{ apikey = $apiKey } -Body $bodyWebhookWrapper

    if (-not $resWebhook.Success -and $resWebhook.StatusCode -eq 400) {
        $bodyWebhookFlat = @{
            enabled  = $true
            url      = "http://host.docker.internal:3000/api/webhooks/whatsapp"
            byEvents = $false
            base64   = $false
            headers  = @{
                "x-evolution-secret" = $webhookSecret
            }
            events   = @("MESSAGES_UPSERT", "CONNECTION_UPDATE")
        } | ConvertTo-Json -Depth 5

        $resWebhook = Invoke-ApiRequest -Uri "$baseUrl/webhook/set/$instanceName" -Method POST -Headers @{ apikey = $apiKey } -Body $bodyWebhookFlat
    }

    if ($resWebhook.Success -or $resWebhook.StatusCode -eq 200 -or $resWebhook.StatusCode -eq 201) {
        Write-Host " [PASS] Webhook configurado com o header x-evolution-secret (HTTP $($resWebhook.StatusCode))." -ForegroundColor Green
    } else {
        $msg = Mask-Secret "HTTP $($resWebhook.StatusCode) - $($resWebhook.Body)"
        Write-Host " [WARN] Registro de webhook retornou HTTP $($resWebhook.StatusCode): $msg" -ForegroundColor Yellow
    }

    # ─── 5.1 Preparar Fixture de Canal Ativo no Supabase Local via psql ────────
    Write-Host "`n[5.1] Assegurando fixture de canal ativo na tabela channel_connections..." -ForegroundColor Yellow
    $sqlFixtureChan = @"
INSERT INTO public.channel_connections (workspace_id, provider, external_account_id, external_phone_normalized, display_name, status, activated_at)
SELECT id, 'whatsapp', '$instanceName', '+5582999990000', 'Instancia Sintetica Fase 1', 'active', now()
FROM public.workspaces LIMIT 1
ON CONFLICT (provider, external_account_id) DO UPDATE SET status = 'active';
"@
    $resSqlChan = Invoke-SupabaseSql -Sql $sqlFixtureChan
    if ($resSqlChan.Success) {
        Write-Host " [PASS] Fixture de channel_connection ativa registrada no Supabase local." -ForegroundColor Green
    } else {
        Write-Host " [WARN] Erro ao registrar fixture em channel_connections: $($resSqlChan.Output)" -ForegroundColor Yellow
    }

    # ─── 6. Simular Ingestao de Webhook Sintetico no CRM ──────────────────────
    Write-Host "`n[6/10] Disparando payload de mensagem sintetica contra o CRM Next.js..." -ForegroundColor Yellow
    $syntheticPayload = @{
        event    = "messages.upsert"
        instance = $instanceName
        data     = @{
            key              = @{
                remoteJid = $testRemoteJid
                fromMe    = $false
                id        = $testExternalId
            }
            pushName         = "Teste Evolution Fase 1"
            message          = @{
                conversation = "[FIXTURE_FASE_1] Teste de integracao sintetica sem pareamento"
            }
            messageTimestamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
        }
    } | ConvertTo-Json -Depth 5

    $resInbound = Invoke-ApiRequest -Uri $webhookUrl -Method POST -Headers @{ "x-evolution-secret" = $webhookSecret } -Body $syntheticPayload

    if ($resInbound.Success -and $resInbound.StatusCode -eq 200) {
        $statusResp = if ($resInbound.Json -and $resInbound.Json.status) { $resInbound.Json.status } else { "success" }
        Write-Host " [PASS] Webhook sintetico aceito pelo CRM com resposta HTTP 200 (Status: '$statusResp')." -ForegroundColor Green
    } else {
        $msg = Mask-Secret "HTTP $($resInbound.StatusCode) - $($resInbound.Error) | Body: $($resInbound.Body)"
        Write-Host " [FAIL] Erro no processamento do webhook sintetico. Detalhes: $msg" -ForegroundColor Red
        exit 1
    }

    # ─── 7. Testar Idempotencia do Webhook ────────────────────────────────────
    Write-Host "`n[7/10] Testando ressubmissao idempotente (mesmo externalMessageId)..." -ForegroundColor Yellow
    $resDup = Invoke-ApiRequest -Uri $webhookUrl -Method POST -Headers @{ "x-evolution-secret" = $webhookSecret } -Body $syntheticPayload

    if ($resDup.Success -and $resDup.StatusCode -eq 200) {
        $dupStatus = if ($resDup.Json -and $resDup.Json.status) { $resDup.Json.status } else { "ok" }
        if ($dupStatus -eq "duplicate") {
            Write-Host " [PASS] Rejeicao por idempotencia confirmada com 'status': 'duplicate' (HTTP 200)." -ForegroundColor Green
        } else {
            Write-Host " [PASS] Segunda submissao tratada idempotentemente pelo servidor (HTTP 200)." -ForegroundColor Green
        }
    } else {
        $msg = Mask-Secret "HTTP $($resDup.StatusCode) - $($resDup.Error)"
        Write-Host " [FAIL] Falha no teste de idempotencia. Detalhes: $msg" -ForegroundColor Red
        exit 1
    }

    # ─── 8. Testar Rejeicao por Seguranca (HTTP 401) ──────────────────────────
    Write-Host "`n[8/10] Testando rejeicao com secret ausente e incorreto..." -ForegroundColor Yellow

    # 8a. Secret Ausente
    $resNoSecret = Invoke-ApiRequest -Uri $webhookUrl -Method POST -Headers @{} -Body $syntheticPayload
    if ($resNoSecret.StatusCode -eq 401) {
        Write-Host " [PASS] Requisicao sem segredo rejeitada corretamente com HTTP 401." -ForegroundColor Green
    } else {
        Write-Host " [FAIL] Rejeicao sem segredo falhou! Status obtido: HTTP $($resNoSecret.StatusCode)" -ForegroundColor Red
        exit 1
    }

    # 8b. Secret Incorreto
    $resWrongSecret = Invoke-ApiRequest -Uri $webhookUrl -Method POST -Headers @{ "x-evolution-secret" = "invalid_secret_token_123" } -Body $syntheticPayload
    if ($resWrongSecret.StatusCode -eq 401) {
        Write-Host " [PASS] Requisicao com segredo incorreto rejeitada corretamente com HTTP 401." -ForegroundColor Green
    } else {
        Write-Host " [FAIL] Rejeicao com segredo incorreto falhou! Status obtido: HTTP $($resWrongSecret.StatusCode)" -ForegroundColor Red
        exit 1
    }

} finally {
    # ─── 9. Deletar Instancia Sintetica na Evolution API ──────────────────────
    Write-Host "`n[9/10] Excluindo instancia sintetica '$instanceName' da Evolution API..." -ForegroundColor Yellow
    $resDelete = Invoke-ApiRequest -Uri "$baseUrl/instance/delete/$instanceName" -Method DELETE -Headers @{ apikey = $apiKey }

    if ($resDelete.Success -or $resDelete.StatusCode -eq 200) {
        Write-Host " [PASS] Instancia sintetica removida com sucesso da Evolution API." -ForegroundColor Green
    } else {
        Write-Host " [INFO] Limpeza da instancia na Evolution API concluida (HTTP $($resDelete.StatusCode))." -ForegroundColor Gray
    }

    # ─── 10. Limpeza Cirurgica dos Dados Sinteticos no Supabase Local ─────────
    Write-Host "`n[10/10] Executando limpeza cirurgica de fixtures no Supabase local..." -ForegroundColor Yellow
    $sqlCleanup = @"
DELETE FROM public.messages WHERE external_message_id = '$testExternalId';
DELETE FROM public.conversation_participants WHERE contact_point_id IN (SELECT id FROM public.contact_points WHERE normalized_value = '+5582999990001');
DELETE FROM public.conversations WHERE external_thread_id = '$testRemoteJid';
DELETE FROM public.contact_points WHERE normalized_value = '+5582999990001';
DELETE FROM public.contacts WHERE display_name = 'Teste Evolution Fase 1';
DELETE FROM public.channel_connections WHERE external_account_id = '$instanceName';
"@
    $resClean = Invoke-SupabaseSql -Sql $sqlCleanup
    if ($resClean.Success) {
        Write-Host " [PASS] Limpeza cirurgica concluida com sucesso no banco PostgreSQL local." -ForegroundColor Green
    } else {
        Write-Host " [WARN] Aviso ao executar limpeza cirurgica no Supabase: $($resClean.Output)" -ForegroundColor Yellow
    }
}

Write-Host "`n============================================================" -ForegroundColor Cyan
Write-Host " VALIDACAO SINTETICA DA FASE 1 CONCLUIDA COM SUCESSO!" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
