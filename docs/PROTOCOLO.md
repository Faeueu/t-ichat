# Protocolo da aplicação (versão Web)

Transporte: WebSocket (RFC 6455) implementado manualmente em Java sobre `Socket` +
`InputStream`/`OutputStream` (sem bibliotecas externas como Spring, Netty ou Tomcat).
O servidor também responde requisições HTTP simples (GET) para servir os arquivos
estáticos da interface (`index.html`, `style.css`, `app.js`).

Porta do servidor: `8080`.

Mensagens de aplicação trafegam dentro de *frames de texto* do WebSocket, no formato
texto simples delimitado por `|` (sem JSON, para manter o parsing simples e 100%
explicável sem bibliotecas).

Foco: chat de suporte entre colaboradores e a equipe de T.I da empresa.

Papéis: todo usuário entra como `COLABORADOR` ou `TI`. Entrar como `TI` exige a senha
fixa `Server.TI_PASSWORD` (`ti123`). O papel acompanha cada mensagem, para a interface
destacar as respostas da T.I e separar técnicos de colaboradores na lista lateral.

Modelo de "salas" (canais): o servidor define uma lista fixa de canais por tipo de
problema (`Avisos da T.I`, `Sistemas`, `Computadores`, `Impressoras`, `Equipamentos`).
Todo usuário entra automaticamente em `Avisos da T.I` ao conectar e pode trocar de canal
a qualquer momento. Em `Avisos da T.I` só a equipe de T.I publica; o servidor recusa
`MSG` de colaboradores ali (`ERROR|somente_ti`).
Mensagens de chat (`MSG`) são sempre roteadas apenas para quem está na mesma sala.
Mensagens privadas (`PRIVATE`) e arquivos privados (`PRIVATE_FILE`) continuam independentes de sala (vão direto a um usuário).

## Cliente -> Servidor

| Mensagem | Descrição |
|---|---|
| `HELLO|<username>|<papel>|<senha>` | Primeira mensagem enviada assim que o WebSocket abre. `papel` é `COLABORADOR` ou `TI`; `senha` só é conferida para `TI` (vazia para colaborador). |
| `JOIN_ROOM|<sala>` | Troca a sala ativa do usuário. Servidor responde com o histórico dessa sala. |
| `MSG|<texto>` | Mensagem para a sala em que o usuário está no momento (broadcast só para quem está nela). |
| `PRIVATE|<destinatario>|<texto>` | Mensagem privada de texto para um usuário específico (não depende de sala). |
| `PRIVATE_FILE|<destinatario>|<filename>|<dataUrl>|<texto>` | Envio de anexo (arquivo, imagem ou planilha codificado em Data URL Base64 com texto opcional) **exclusivo para o chat privado**. |

## Servidor -> Cliente

| Mensagem | Descrição |
|---|---|
| `WELCOME|<username>|<papel>` | Confirma que o `HELLO` foi aceito. |
| `ERROR|<motivo>` | Rejeita a operação (`nome_em_uso`, `nome_invalido`, `senha_invalida`, `papel_invalido`, `somente_ti`, `sala_invalida`, `usuario_offline`). Em erro de `HELLO`, o servidor fecha a conexão. |
| `ROOMS|<s1>,<s2>,...` | Lista fixa de salas disponíveis. Enviada uma vez, logo após `WELCOME`. |
| `ANNOUNCEMENTS|<sala>` | Nome do canal em que só a T.I publica. Enviada logo após `ROOMS`. |
| `PENDING|<sala>|<quantidade>` | Só para a T.I: quantas mensagens de colaboradores naquela sala aguardam resposta. Enviada para cada sala logo após o login de um técnico e de novo a cada `MSG` na sala (mensagem de colaborador soma 1; mensagem da T.I zera). A interface mostra o número numa bolinha vermelha ao lado do canal. |
| `USERS|<u1>:<papel>,<u2>:<papel>,...` | Lista completa de usuários online, com o papel de cada um (não depende de sala). Reenviada a todos a cada entrada/saída. |
| `JOIN|<username>|<papel>` | Aviso de sistema: usuário entrou no servidor. |
| `LEAVE|<username>|<papel>` | Aviso de sistema: usuário saiu do servidor. |
| `HISTORY_BEGIN|<sala>` | Sinaliza que o usuário (re)entrou nessa sala. O cliente deve limpar a área de mensagens na tela. |
| `MSG|<sala>|<remetente>|<papel>|<epochMillis>|<texto>` | Mensagem de chat da sala. Usada tanto para repassar o histórico salvo quanto para mensagens novas — o formato é o mesmo. |
| `HISTORY_END|<sala>` | Marca o fim do replay do histórico; mensagens que chegarem depois disso são "ao vivo". |
| `PRIVATE|<remetente>|<papel>|<epochMillis>|<texto>` | Mensagem privada de texto, repassada ao destinatário E ecoada ao remetente (para ele ver a própria mensagem enviada). |
| `PRIVATE_FILE|<remetente>|<papel>|<epochMillis>|<filename>|<dataUrl>|<texto>` | Arquivo, imagem ou planilha privado, repassado ao destinatário E ecoado ao remetente. |

Observações de design:
- `epochMillis` é o timestamp (`System.currentTimeMillis()`) gerado no servidor no
  momento do recebimento, não no cliente — evita depender do relógio do navegador.
- Nomes de usuário duplicados são rejeitados (`ERROR|nome_em_uso`), pois a lista de
  usuários é uma chave única usada para rotear mensagens privadas. Nomes com `,` ou `:`
  são rejeitados (`ERROR|nome_invalido`), porque esses caracteres separam a lista `USERS`.
- Não há un/marshalling JSON de propósito: o objetivo é poder explicar o protocolo
  linha a linha no quadro, sem "caixa-preta" de biblioteca.
- **Envio de arquivos no privado**: suporta imagens (com preview inline e download), planilhas (com badge e download) e arquivos gerais de até 8 MB transmitidos via Data URL Base64 dentro de frames WebSocket com suporte a continuação/fragmentação (RFC 6455). Fica estritamente restrito ao canal privado (`privateTarget`), sendo bloqueado nos canais públicos.
- O histórico fica **em memória** no servidor (não há banco de dados), limitado a um
  número máximo de mensagens por sala (as mais antigas são descartadas). Isso significa
  que o histórico existe só enquanto o servidor estiver rodando — é o suficiente para
  demonstrar "novo integrante vê as mensagens anteriores da sala" sem a complexidade de
  persistência em disco/banco, que é um dos desafios opcionais não escolhidos.
