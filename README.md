# Chat Java — versão Web (Sockets, Streams e Multithreading)

Aplicação de chat em Java com back-end puro (sem frameworks) usando `ServerSocket`,
`Socket`, `InputStream`/`OutputStream` e uma `Thread` por cliente conectado. A interface
é uma página web (HTML/CSS/JS puros) que fala com o servidor via **WebSocket**,
implementado manualmente em cima de Sockets — sem Spring, Netty, Tomcat ou qualquer
biblioteca de rede externa.

Pensada como um "chat interno de empresa" (inspirado em ferramentas como o Microsoft
Teams): o usuário entra, escolhe um canal (sala) na lateral, conversa em grupo ou manda
mensagem privada para alguém específico. Quem entra em um canal que já tinha conversa
anterior vê o histórico automaticamente — simulando um novo integrante de equipe.

> Existe também uma primeira versão em `src/` (cliente desktop Swing), mantida como
> histórico do desenvolvimento. A versão avaliada é a web, em `webchat/`.

## 1. Requisitos do trabalho x onde cada um foi atendido

| Requisito | Onde |
|---|---|
| Comunicação cliente-servidor com Sockets e Streams | `webchat/server/src/webchat/Server.java` (`ServerSocket`/`Socket`) e `WebSocketCodec.java` (lê/escreve diretamente em `InputStream`/`OutputStream`) |
| Múltiplos clientes simultâneos via Multithreading | `Server.java`: uma `new Thread(new ClientHandler(...))` por conexão aceita |
| Envio/recebimento de mensagens entre clientes | `ClientHandler.broadcast()` (grupo) e `ClientHandler.handleMessage()` (mensagem privada) |
| Gerenciar conexão/desconexão sem derrubar os demais | cada `ClientHandler` roda isolado em sua própria thread, com `try/finally` cuidando da limpeza (`disconnect()`) |
| Demonstração com 3+ clientes simultâneos | ver roteiro de demonstração na seção 5 |

### Desafios opcionais escolhidos (sugeridos pelo professor)

De propósito, escolhemos só dois dos desafios opcionais, para manter o projeto fácil de
explicar por completo:

| Desafio opcional | Onde |
|---|---|
| Identificação de usuários | tela de login + `HELLO|<username>`, nomes únicos (`ERROR|nome_em_uso`) |
| Mensagens privadas | `PRIVATE|<destinatario>|<texto>`, roteada só ao destinatário + eco ao remetente |
| Salas de conversa (grupos/canais) | lista fixa `Server.ROOMS`, cada `ClientHandler` guarda em qual sala está (`currentRoom`), broadcast filtra por sala |
| Histórico de mensagens (para novos integrantes) | `Server.roomHistory` (mapa sala -> lista de mensagens em memória), reenviado via `HISTORY_BEGIN`/`HISTORY_END` sempre que alguém entra numa sala |
| Lista de usuários online | mensagem `USERS`, exibida na barra lateral |

Não implementamos (de propósito, para não inflar o escopo): banco de dados/persistência
em disco, envio de arquivos/imagens e comandos de texto tipo `/sair`. Esses ficam
mencionados aqui só para deixar claro que foi uma escolha consciente de escopo, não um
esquecimento.

## 2. Arquitetura

```
Navegador (aba 1) ──┐
Navegador (aba 2) ──┼── WebSocket (ws://localhost:8080/ws) ──► Server.java (ServerSocket, loop accept())
Navegador (aba 3) ──┘                                                 │
                                                          cria 1 Thread por conexão
                                                                       │
                                                              ClientHandler.java
                                                        (handshake HTTP->WS, le/escreve frames,
                                                         broadcast, mensagens privadas)
                                                                       │
                                                     ConcurrentHashMap<username, ClientHandler>
                                                        (registro compartilhado entre threads)
                                                                       │
                                                     ConcurrentHashMap<sala, List<mensagens>>
                                                      (historico compartilhado, por sala, em memoria)
```

Arquivos do back-end (`webchat/server/src/webchat/`):

- **`Server.java`** — ponto de entrada. Abre o `ServerSocket` na porta 8080, define a
  lista fixa de salas (`ROOMS`) e o histórico compartilhado (`roomHistory`), e fica em
  loop aceitando conexões. Cada conexão vira uma `Thread` nova rodando um `ClientHandler`.
- **`ClientHandler.java`** — o núcleo do protocolo da aplicação. Roda em sua própria
  thread (uma por aba de navegador conectada). Resolve a requisição HTTP inicial, faz o
  handshake do WebSocket se for `/ws`, registra o usuário, coloca ele na sala padrão
  ("Geral") e entra num loop bloqueante lendo mensagens (`readTextFrame`) até a conexão
  cair. Guarda em qual sala o usuário está (`currentRoom`) para rotear/filtrar mensagens
  e salva cada mensagem de grupo no histórico da sala correspondente.
- **`WebSocketCodec.java`** — toda a parte "protocolo bruto": parsing da requisição HTTP
  (linha + headers), cálculo do `Sec-WebSocket-Accept` (SHA-1 + Base64 conforme RFC 6455),
  e codificação/decodificação manual dos frames binários do WebSocket (incluindo
  desmascaramento dos frames que vêm do navegador).
- **`StaticFileServer.java`** — serve `index.html`, `style.css` e `app.js` via HTTP comum
  (sem WebSocket), para qualquer requisição que não seja `/ws`.

Front-end (`webchat/web/`): `index.html` + `style.css` + `app.js`, sem nenhum framework
(nenhum React/Vue/jQuery), para que seja possível explicar o JS linha a linha.

## 3. Decisões técnicas (para a arguição)

- **Por que implementar o WebSocket na mão, em vez de usar uma biblioteca HTTP/WS pronta?**
  O enunciado pede explicitamente para demonstrar Sockets, Streams e Multithreading. Usar
  uma lib pronta (ex. Java-WebSocket, Spark, Jetty) esconderia justamente a parte avaliada.
  Implementando à mão, cada linha do handshake e da leitura/escrita de frames é código
  nosso, sobre `Socket.getInputStream()`/`getOutputStream()` puros.

- **Por que WebSocket e não só long-polling HTTP?** WebSocket mantém uma única conexão
  TCP aberta (um único `Socket`/thread por cliente, igual à versão desktop anterior),
  permitindo que o servidor envie mensagens para o navegador a qualquer momento — o
  mesmo modelo de "thread bloqueada em `read()` esperando dado" da primeira versão
  (Swing), só que a "leitura" acontece dentro de frames WebSocket em vez de linhas de texto.

- **Por que um protocolo de aplicação em texto simples (`TIPO|campo|campo`) em vez de JSON?**
  Evita depender de uma biblioteca de serialização (Gson/Jackson) e mantém o protocolo
  100% legível e explicável no quadro, linha a linha. Ver `docs/PROTOCOLO.md`.

- **Por que `ConcurrentHashMap<String, ClientHandler>` em vez de uma lista comum?**
  Várias threads (uma por cliente) leem e escrevem nesse registro ao mesmo tempo
  (entrar, sair, fazer broadcast, procurar destinatário de mensagem privada). Uma
  `HashMap` comum não é segura para uso concorrente (pode corromper a estrutura
  interna); `ConcurrentHashMap` é. Além disso, `putIfAbsent()` resolve de forma atômica
  o problema de dois clientes tentarem registrar o mesmo nome de usuário ao mesmo tempo.

- **Por que cada `ClientHandler` tem seu próprio `try/catch/finally`?** Para isolar
  falhas: se o navegador de um usuário fecha abruptamente, só a thread daquele cliente
  recebe a exceção, faz a limpeza (`disconnect()`, remove do mapa, avisa os outros) e
  termina — as demais threads nunca são afetadas.

- **Por que o servidor também serve os arquivos estáticos (HTML/CSS/JS)?** Para não
  precisar de um segundo servidor (ex. um dev server Node) só para a página — o mesmo
  `ServerSocket`/`Socket` atende tanto `GET /` (HTTP comum) quanto `GET /ws` (upgrade
  para WebSocket), reforçando que é tudo a mesma infraestrutura de Sockets.

- **Como as salas (canais) foram implementadas sem criar uma classe "Sala" separada?**
  Cada `ClientHandler` guarda um campo `currentRoom` (a sala que ele está vendo agora).
  Para fazer broadcast numa sala, basta percorrer o registro de clientes que já existia
  (`clients.values()`) e filtrar quem tem `currentRoom` igual à sala da mensagem. Isso
  evitou criar uma segunda estrutura de dados (lista de membros por sala) só para
  duplicar uma informação que o próprio `ClientHandler` já guardava.

- **Por que o histórico fica em memória (`List<String>` por sala) em vez de banco de
  dados?** O desafio opcional de persistência em disco/banco foi propositalmente deixado
  de fora para não aumentar a complexidade do projeto. Guardar as mensagens já formatadas
  (a própria String `MSG|sala|remetente|timestamp|texto`) numa lista por sala é suficiente
  para demonstrar "novo integrante vê o histórico do canal": quando alguém entra numa
  sala, o servidor simplesmente reenvia essas mesmas strings salvas, uma por uma. O
  histórico existe só enquanto o processo do servidor estiver de pé — reiniciar o
  servidor zera as conversas, o que é aceitável para o escopo da avaliação.

- **Por que limitar o histórico a `HISTORY_LIMIT` (100) mensagens por sala?** Sem um
  limite, a lista de cada sala cresceria indefinidamente durante a demonstração,
  consumindo memória sem necessidade. `saveToHistory()` remove a mensagem mais antiga
  sempre que o tamanho passa do limite — um `synchronized` nesse trecho evita que duas
  threads adicionem mensagens na mesma sala ao mesmo tempo e corrompam a lista.

## 4. Como compilar e rodar

Pré-requisito: JDK 21 (Eclipse Temurin) instalado.

```bash
# compilar
javac -d webchat/out webchat/server/src/webchat/*.java

# rodar o servidor (a partir da raiz do projeto, para achar webchat/web)
java -cp webchat/out webchat.Server
```

Depois, abra `http://localhost:8080` em quantas abas/navegadores quiser.

## 5. Roteiro de demonstração (3+ clientes)

1. Suba o servidor (`java -cp webchat/out webchat.Server`) — ele imprime a porta no console.
2. Abra 3 abas (ou navegadores) em `http://localhost:8080`.
3. Entre com nomes diferentes em cada aba (ex: Ana, Bruno, Carla). Todas devem ver os
   avisos `"X entrou no chat"`, a lista de usuários online atualizada na lateral, e
   começar automaticamente no canal "Geral".
4. Mande uma mensagem de uma aba — deve aparecer nas outras duas, com o nome do
   remetente e o horário.
5. Clique em outro canal (ex: "TI") numa das abas — a tela de mensagens deve limpar e
   mostrar (vazio, pois ninguém ainda escreveu ali). Volte para "Geral" na mesma aba e
   confira que as mensagens anteriores reaparecem (é o próprio histórico sendo
   reenviado).
6. Clique no nome de um usuário na lista lateral de outra aba para selecioná-lo, envie
   uma mensagem — só ele deve recebê-la (marcada como "(privado)"); a terceira aba não
   deve ver nada.
7. Feche uma das abas — as outras duas devem continuar funcionando normalmente e
   receber o aviso `"X saiu do chat"` (prova de que a desconexão de um cliente não
   derruba os demais).
8. Para demonstrar o histórico "para novos integrantes": com Ana e Bruno já tendo
   conversado em "Geral", abra uma quarta aba e entre com um nome novo (ex: Carla) — ela
   deve ver as mensagens anteriores de Ana e Bruno assim que a tela de chat aparecer,
   sem precisar fazer nada.

## 6. Possíveis perguntas da banca (e por onde responder)

- *"Onde está o Multithreading?"* → `Server.java`, dentro do `while(true)`: cada
  `accept()` gera uma `new Thread(...)`. Sem isso, o `accept()` e o `readTextFrame()`
  (bloqueantes) impediriam atender mais de um cliente por vez.
- *"O que acontece se dois clientes tentam usar o mesmo nome ao mesmo tempo?"* →
  `ClientHandler.chatLoop()`, `clients.putIfAbsent(desiredName, this)`: operação atômica
  do `ConcurrentHashMap`; quem perder a corrida recebe `ERROR|nome_em_uso`.
  (ver [ClientHandler.java](webchat/server/src/webchat/ClientHandler.java))
- *"Como o navegador conversa com um Socket Java, já que `Socket` não é WebSocket?"* →
  WebSocket É só um protocolo em cima de uma conexão TCP comum: começa como uma
  requisição HTTP normal com headers `Upgrade: websocket`, o servidor responde `101
  Switching Protocols`, e a partir daí o mesmo `Socket` passa a trocar "frames"
  binários em vez de texto HTTP. Isso está todo em `WebSocketCodec.java`.
- *"Por que mensagens do cliente vêm mascaradas e as do servidor não?"* → Regra do
  RFC 6455: é uma proteção contra ataques de cache-poisoning em proxies HTTP — só o
  lado que inicia a conexão (o navegador) é obrigado a mascarar.
- *"Como uma mensagem só chega em quem está na mesma sala?"* →
  `ClientHandler.broadcastToRoom()`: percorre `clients.values()` (todos os conectados)
  e só chama `send()` em quem tem `currentRoom` igual à sala da mensagem. Não existe uma
  lista separada "membros da sala X" — a própria coleção de clientes já guarda isso.
- *"O que acontece com o histórico se o servidor reiniciar?"* → Ele é perdido, pois vive
  só na memória (`List<String>` dentro de `Server.roomHistory`). É uma limitação
  assumida conscientemente — persistir em banco era um desafio opcional que decidimos
  não implementar para manter o projeto enxuto.
- *"Por que vocês guardam a mensagem já formatada (a String inteira) no histórico, em
  vez de um objeto com campos separados?"* → Porque reenviar o histórico é literalmente
  reenviar, frame a frame, as mesmas mensagens que já foram mandadas para todo mundo —
  não precisamos reconstruir nada, só repetir a mesma String já pronta (`MSG|sala|...`).

## 7. Sobre o uso de ferramentas de IA neste projeto

O desenvolvimento usou Claude Code como par de programação (decisões de arquitetura e
protocolo, e a maior parte da implementação, foram discutidas e escritas junto). Houve
uma tentativa de delegar dois módulos isolados (o codec de WebSocket e o front-end) a
um segundo agente (Codex CLI) rodando em paralelo via terminal; essa tentativa falhou
por um problema de sandbox do Windows nesta máquina (sem relação com o código), então
esses dois módulos acabaram sendo escritos diretamente. Recomendamos que a dupla leia
`ClientHandler.java` e `WebSocketCodec.java` com atenção antes da apresentação — são os
dois arquivos mais prováveis de gerar perguntas detalhadas.
