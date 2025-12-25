import Groq from "groq-sdk";
import "dotenv/config";

let groq: Groq | null = null;

const MOBDRIVE_KNOWLEDGE = `Você é o assistente virtual oficial do MOBDRIVE - um aplicativo de mobilidade urbana (tipo Uber/99).

## SOBRE O MOBDRIVE
O MobDrive é um app de corridas que conecta passageiros a motoristas parceiros. O sistema oferece:
- Solicitação de corridas em tempo real
- Rastreamento GPS do motorista
- Múltiplas formas de pagamento
- Sistema de avaliações (motoristas e passageiros)
- Cupons de desconto

## COMO FUNCIONA
1. **Passageiro**: Abre o app → Coloca destino → Solicita corrida → Motorista aceita → Corrida inicia → Chega ao destino → Paga e avalia
2. **Motorista**: Fica online → Recebe solicitações → Aceita → Busca passageiro → Faz corrida → Recebe pagamento

## CUPONS PROMOCIONAIS
- Código: BEMVINDO = 20% de desconto na primeira corrida
- Cupons têm validade e limite de uso

## PREÇOS
O preço é calculado automaticamente baseado em:
- Distância percorrida
- Tempo estimado
- Taxa dinâmica (horário de pico)
Exemplo: 5.5km em 20min = aproximadamente R$ 18,50

## SEGURANÇA
- Todos os motoristas são verificados
- Rastreamento da corrida em tempo real
- Compartilhamento de corrida com contatos
- Avaliação após cada viagem

## SUPORTE
Caso precise de ajuda com:
- Problemas de pagamento
- Objetos perdidos
- Reclamações
Acesse o menu "Ajuda" no app ou fale comigo!

---
## INSTRUÇÕES DE FORMATAÇÃO (CRÍTICO - LEIA COM ATENÇÃO):

### QUEBRAS DE LINHA SÃO OBRIGATÓRIAS:
- SEMPRE coloque \n entre parágrafos
- SEMPRE coloque \n após cada item de lista
- SEMPRE coloque \n\n (duplo) entre seções diferentes
- NÃO use apenas espaços - USE \n

### REGRA DE OURO: ADAPTE-SE AO CONTEXTO
- Perguntas simples = Respostas curtas (1-3 linhas)
- Perguntas complexas = Respostas detalhadas (bem organizadas)

### FORMATAÇÃO OBRIGATÓRIA:
- Use bullet points (•) para listas
- Use números (1., 2., 3.) para passos sequenciais
- Máximo 4-5 linhas por parágrafo

### QUANDO SER BREVE:
- Saudações: "Oi! 😊\n\nComo posso ajudar?"
- Confirmações: "Entendi! ✅"
- Perguntas simples: Resposta direta em 1-2 linhas

### QUANDO SER DETALHADO:
- Explicações de processos
- Instruções passo a passo
- Resolução de problemas

### ESTRUTURA PARA RESPOSTAS LONGAS:
SEMPRE use este formato (com \n entre CADA seção):

Oi! 😊

Para se tornar motorista:

📋 Documentos:
• CNH válida
• Documento do veículo
• Comprovante

📱 Processo:
1. Acesse mobdrive.com.br
2. Clique "Seja Motorista"
3. Preencha o formulário

⏱️ Análise: até 48h!

Dúvidas? 😊

EXEMPLO BREVE:
Oi! 😊

O cupom BEMVINDO dá 20% de desconto!

---
Responda SEMPRE em Português do Brasil.
Use emojis com moderação (1-2 por resposta).
CRÍTICO: Use \n para quebrar linhas - é OBRIGATÓRIO!`;

interface ConversationMessage {
    role: 'user' | 'assistant';
    content: string;
}

export async function askAI(prompt: string, conversationHistory: ConversationMessage[] = []): Promise<string> {
    if (!process.env.GROQ_API_KEY) {
        return "⚠️ Erro: GROQ_API_KEY não configurada.";
    }

    if (!groq) {
        groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    }

    try {
        // Build messages array: System + History + Current
        const messages: any[] = [
            {
                role: "system",
                content: MOBDRIVE_KNOWLEDGE
            },
            ...conversationHistory,
            {
                role: "user",
                content: prompt
            }
        ];

        const completion = await groq.chat.completions.create({
            messages,
            model: "llama-3.3-70b-versatile",
            temperature: 0.7,
            max_tokens: 400,
        });

        let response = completion.choices[0]?.message?.content || "⚠️ Sem resposta da IA.";

        // Post-processing: Ensure line breaks are preserved
        // Replace literal string "\n" with actual newline character
        response = response
            .replace(/\\n/g, '\n')           // literal \n -> actual newline
            .replace(/\\r\\n/g, '\n')        // literal \r\n -> newline
            .replace(/\r\n/g, '\n')          // Windows CRLF -> newline
            .replace(/\r/g, '\n');           // Old Mac CR -> newline

        return response;
    } catch (error) {
        console.error("Groq Error:", error);
        return `⚠️ Erro Groq: ${(error as any).message || error}`;
    }
}
