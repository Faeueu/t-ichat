# Protocolo da aplicação (versão Web)

Transporte: WebSocket (RFC 6455) implementado manualmente em Java sobre `Socket` +
`InputStream`/`OutputStream` (sem bibliotecas externas como Spring, Netty ou Tomcat).
O servidor também responde requisições HTTP simples (GET) para servir os arquivos
estáticos da interface (`index.html`, `style.css`, `app.js`).

Porta do servidor: `8080`.

Mensagens de aplicação trafegam dentro de *frames de texto* do WebSocket, no formato
texto simples delimitado por `|` (sem JSON, para manter o parsing simples e 100%
explicável sem bibliotecas).

Modelo de "salas" (canais): o servidor define uma lista fixa de salas (ex: Geral,
Vendas, TI, RH), simulando os canais de um chat interno de empresa. Todo usuário entra
automaticamente na sala "Geral" ao conectar e pode trocar de sala a qualquer momento.
Mensagens de chat (`MSG`) são sempre roteadas apenas para quem está na mesma sala.
Mensagens privadas (`PRIVATE`) continuam independentes de sala (vão direto a um usuário).

## Cliente -> Servidor

| Mensagem | Descrição |
|---|---|
| `HELLO|<username>` | Primeira mensagem enviada assim que o WebSocket abre. Registra o usuário. |
| `JOIN_ROOM|<sala>` | Troca a sala ativa do usuário. Servidor responde com o histórico dessa sala. |
| `MSG|<texto>` | Mensagem para a sala em que o usuário está no momento (broadcast só para quem está nela). |
| `PRIVATE|<destinatario>|<texto>` | Mensagem privada para um usuário específico (não depende de sala). |

## Servidor -> Cliente

| Mensagem | Descrição |
|---|---|
| `WELCOME|<username>` | Confirma que o `HELLO` foi aceito. |
| `ERROR|<motivo>` | Rejeita a operação (`nome_em_uso`, `sala_invalida`, `usuario_offline`). Em erro de `HELLO`, o servidor fecha a conexão. |
| `ROOMS|<s1>,<s2>,...` | Lista fixa de salas disponíveis. Enviada uma vez, logo após `WELCOME`. |
| `USERS|<u1>,<u2>,...` | Lista completa de usuários online no servidor (não depende de sala). Reenviada a todos a cada entrada/saída. |
| `JOIN|<username>` | Aviso de sistema: usuário entrou no servidor. |
| `LEAVE|<username>` | Aviso de sistema: usuário saiu do servidor. |
| `HISTORY_BEGIN|<sala>` | Sinaliza que o usuário (re)entrou nessa sala. O cliente deve limpar a área de mensagens na tela. |
| `MSG|<sala>|<remetente>|<epochMillis>|<texto>` | Mensagem de chat da sala. Usada tanto para repassar o histórico salvo quanto para mensagens novas — o formato é o mesmo. |
| `HISTORY_END|<sala>` | Marca o fim do replay do histórico; mensagens que chegarem depois disso são "ao vivo". |
| `PRIVATE|<remetente>|<epochMillis>|<texto>` | Mensagem privada, repassada ao destinatário E ecoada ao remetente (para ele ver a própria mensagem enviada). |

Observações de design:
- `epochMillis` é o timestamp (`System.currentTimeMillis()`) gerado no servidor no
  momento do recebimento, não no cliente — evita depender do relógio do navegador.
- Nomes de usuário duplicados são rejeitados (`ERROR|nome_em_uso`), pois a lista de
  usuários é uma chave única usada para rotear mensagens privadas.
- Não há un/marshalling JSON de propósito: o objetivo é poder explicar o protocolo
  linha a linha no quadro, sem "caixa-preta" de biblioteca.
- O histórico fica **em memória** no servidor (não há banco de dados), limitado a um
  número máximo de mensagens por sala (as mais antigas são descartadas). Isso significa
  que o histórico existe só enquanto o servidor estiver rodando — é o suficiente para
  demonstrar "novo integrante vê as mensagens anteriores da sala" sem a complexidade de
  persistência em disco/banco, que é um dos desafios opcionais não escolhidos.
