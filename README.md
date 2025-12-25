# WhatsApp Bot - Baileys + Supabase

Bot de WhatsApp usando **Baileys** (biblioteca não-oficial do WhatsApp Web) com integração ao **Supabase** para persistir mensagens.

## Pré-requisitos

- Node.js 18+
- Conta no Supabase com a tabela `messages` criada
- Conta no Railway (ou outro serviço de hospedagem)

## Variáveis de Ambiente

| Variável | Descrição |
|----------|-----------|
| `SUPABASE_URL` | URL do seu projeto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave de serviço (service role) do Supabase |
| `AUTH_FOLDER` | (Opcional) Caminho para salvar a sessão do WhatsApp. Padrão: `./auth_state` |

## Instalação Local

```bash
cd baileys
npm install
npm run dev
```

O servidor web será iniciado em [http://localhost:3000](http://localhost:3000). Acesse essa URL para ver o QR Code e escanear com seu WhatsApp.

## Credenciais do Projeto

**Database Password**: `SupabaseBot2025!`
**Project Ref**: `mfsuhrtvertzoggvlwxv`

## Deploy no Railway

1. Crie um novo projeto no Railway
2. Conecte o repositório Git ou faça upload do código
3. Adicione as variáveis de ambiente (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`)
4. O Railway detectará o `Dockerfile` e fará o build automaticamente
5. A aplicação abrirá automaticamente a porta 3000. Acesse a **URL Pública** do seu serviço no Railway para visualizar o QR Code.

> **Importante**: Para persistir a sessão entre deploys, configure um volume no Railway apontando para `/app/auth_state`.

## Estrutura do Banco de Dados (Supabase)

```sql
CREATE TABLE public.messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    from_number text NOT NULL,
    body text NOT NULL,
    direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    received_at timestamp with time zone DEFAULT now()
);
```

## Personalização

Edite a função `handleMessage` em `src/bot.ts` para implementar sua lógica de bot (IA, regras de negócio, etc.).
