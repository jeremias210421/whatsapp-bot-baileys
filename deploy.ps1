# Deploy Script for Railway

Write-Host "🚀 Iniciando deploy no Railway..."

# 1. Login
Write-Host "1. Autenticação (se abrir o navegador, faça login)"
railway login

# 2. Init Project
Write-Host "2. Inicializando projeto..."
railway init --name "whatsapp-bot-baileys"

# 3. Instruction for Env Vars
Write-Host "⚠️  IMPORTANTE: Antes de finalizar, você precisa configurar as variáveis no Railway."
Write-Host "   Acesse o painel do Railway (que abrirá em breve) e adicione:"
Write-Host "   - SUPABASE_URL: https://mfsuhrtvertzoggvlwxv.supabase.co"
Write-Host "   - SUPABASE_SERVICE_ROLE_KEY: (Pegue no painel do Supabase: Project Settings > API)"

# 4. Deploy
Write-Host "3. Fazendo upload e deploy..."
railway up

Write-Host "✅ Deploy iniciado! Acompanhe os logs no terminal ou painel para ver o QR Code."
