# 🚀 Deploy Final - WhatsApp Bot no Railway

## ✅ O que já está pronto:
- ✅ Código do bot (`src/bot.ts`)
- ✅ Banco de dados Supabase configurado
- ✅ Dockerfile para deploy
- ✅ Git repository inicializado e commitado

## 📋 Passos Finais (2 minutos):

### 1️⃣ Criar Repositório no GitHub
```bash
# Opção A: Via GitHub CLI (se tiver instalado)
gh repo create whatsapp-bot-baileys --public --source=. --push

# Opção B: Manual
# 1. Vá em https://github.com/new
# 2. Nome: whatsapp-bot-baileys
# 3. Clique em "Create repository"
# 4. Execute no terminal:
git remote add origin https://github.com/SEU_USUARIO/whatsapp-bot-baileys.git
git branch -M main
git push -u origin main
```

### 2️⃣ Conectar ao Railway
1. Acesse: https://railway.app/new
2. Clique em **"Deploy from GitHub repo"**
3. Selecione o repositório **whatsapp-bot-baileys**
4. Railway vai detectar o Dockerfile automaticamente

### 3️⃣ Configurar Variáveis de Ambiente no Railway
No painel do Railway, vá em **Variables** e adicione:

```
SUPABASE_URL=https://mfsuhrtvertzoggvlwxv.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<COPIE DO SUPABASE: Project Settings > API > service_role key>
```

### 4️⃣ Ver o QR Code
1. Após o deploy, clique em **"View Logs"**
2. O QR Code vai aparecer nos logs
3. Escaneie com o WhatsApp do celular

### 5️⃣ (IMPORTANTE) Persistir a Sessão
1. No Railway, vá em **Settings > Volumes**
2. Crie um volume apontando para: `/app/auth_state`
3. Isso evita ter que escanear o QR toda vez que o container reiniciar

## 🎉 Pronto!
Seu bot estará rodando 24/7 no Railway e salvando todas as conversas no Supabase!

## 🔧 Comandos Úteis:
```bash
# Ver logs do Railway
railway logs

# Redeploy (se precisar)
git add .
git commit -m "Update"
git push
```

## 📝 Credenciais Salvas:
- **DB Password**: `SupabaseBot2025!`
- **Project Ref**: `mfsuhrtvertzoggvlwxv`
- **Supabase URL**: `https://mfsuhrtvertzoggvlwxv.supabase.co`
