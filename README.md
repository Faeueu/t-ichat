# Suporte T.I — chat web em Java (Sockets, Streams e Multithreading)

Aplicação de chat em Java com back-end puro (sem frameworks) usando `ServerSocket`,
`Socket`, `InputStream`/`OutputStream` e uma `Thread` por cliente conectado. A interface
é uma página web (HTML/CSS/JS puros) que fala com o servidor via **WebSocket**,
implementado manualmente em cima de Sockets — sem Spring, Netty, Tomcat ou qualquer
biblioteca de rede externa.

Pensada como o canal de comunicação entre os colaboradores de uma empresa e o setor de
T.I: quem tem problema com sistemas, computadores, impressoras ou outros equipamentos
relata no canal da categoria, e a equipe de T.I responde (no canal ou em mensagem
privada). A T.I também publica comunicados num canal só dela, `Avisos da T.I`. Quem
entra num canal que já tinha conversa vê o histórico automaticamente, e assim um técnico
que chega depois sabe o que já foi relatado.

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
| Identificação de usuários | tela de login + `HELLO|<username>|<papel>|<senha>`, nomes únicos (`ERROR|nome_em_uso`) e dois papéis: `COLABORADOR` e `TI` (este com senha) |
| Mensagens privadas | `PRIVATE|<destinatario>|<texto>`, roteada só ao destinatário + eco ao remetente |
| Salas de conversa (grupos/canais) | lista fixa `Server.ROOMS`, um canal por tipo de problema; cada `ClientHandler` guarda em qual sala está (`currentRoom`), broadcast filtra por sala. `Avisos da T.I` aceita mensagens só da T.I (`ERROR|somente_ti`) |
| Histórico de mensagens (para novos integrantes) | `Server.roomHistory` (mapa sala -> lista de mensagens em memória), reenviado via `HISTORY_BEGIN`/`HISTORY_END` sempre que alguém entra numa sala |
| Notificação de mensagens pendentes | `Server.pendingReplies` (contador por sala), enviado só à T.I via `PENDING|sala|n` e exibido como bolinha vermelha no canal |
| Lista de usuários online | mensagem `USERS` (`nome:papel`), exibida na barra lateral separada em "Equipe de T.I" e "Colaboradores" |

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
  lista fixa de canais (`ROOMS`), o canal de avisos (`ANNOUNCEMENTS_ROOM`), os papéis
  (`ROLE_TI`/`ROLE_COLABORADOR`), a senha da T.I (`TI_PASSWORD`) e o histórico
  compartilhado (`roomHistory`), e fica em loop aceitando conexões. Cada conexão vira uma `Thread` nova rodando um `ClientHandler`.
- **`ClientHandler.java`** — o núcleo do protocolo da aplicação. Roda em sua própria
  thread (uma por aba de navegador conectada). Resolve a requisição HTTP inicial, faz o
  handshake do WebSocket se for `/ws`, valida nome, papel e senha, registra o usuário,
  coloca ele na sala padrão ("Avisos da T.I") e entra num loop bloqueante lendo mensagens (`readTextFrame`) até a conexão
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

- **Como os papéis (T.I x colaborador) foram implementados?** Cada `ClientHandler`
  ganhou um campo `role`, preenchido no `HELLO`. Entrar como T.I exige a senha fixa
  `Server.TI_PASSWORD`, o suficiente para uma demonstração local (não é autenticação
  de verdade, que exigiria cadastro de usuários e senhas guardadas com hash). O papel
  viaja em cada `MSG`/`PRIVATE`/`USERS`, e a interface usa isso para destacar a T.I.

- **Por que a regra "só a T.I escreve em Avisos" está no servidor, e não só na tela?**
  Desabilitar o campo de texto no navegador é só conveniência: qualquer pessoa pode
  abrir o console e mandar `MSG|...` direto pelo WebSocket. Quem decide é o
  `ClientHandler.handleMessage()`, que recusa com `ERROR|somente_ti`.

- **Como funciona a bolinha vermelha de pendentes?** O servidor guarda, por sala, quantas
  mensagens de colaboradores vieram depois da última resposta da T.I
  (`Server.pendingReplies`). O contador é atualizado dentro do mesmo `synchronized` que
  salva a mensagem no histórico, para que duas mensagens simultâneas não percam contagem.
  A cada mudança, o novo valor vai só para os técnicos (`broadcastToTi`). Resposta
  privada não zera o contador, só uma resposta no próprio canal.

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

Depois, abra `http://localhost:8080` em quantas abas/navegadores quiser. Na tela de
login, escolha **Colaborador** (só o nome) ou **Equipe de T.I** (nome + senha `ti123`).

## 5. Roteiro de demonstração (3+ clientes)

1. Suba o servidor (`java -cp webchat/out webchat.Server`) — ele imprime a porta no console.
2. Abra 3 abas (ou navegadores) em `http://localhost:8080`.
3. Na primeira aba, entre como **Equipe de T.I** (ex: Carlos, senha `ti123`). Teste
   antes uma senha errada para mostrar a recusa ("Senha da equipe de T.I incorreta").
4. Nas outras duas, entre como **Colaborador** (ex: Ana e Bruno). Todas devem ver os
   avisos `"X (papel) entrou no chat"`, e a lateral deve mostrar Carlos em "Equipe de
   T.I" e os demais em "Colaboradores". Todos começam em `Avisos da T.I`.
5. Na aba da Ana, note que o campo de texto em `Avisos da T.I` fica desabilitado. Na
   aba do Carlos, publique um aviso (ex: "Manutenção da rede hoje às 18h") — ele aparece
   para todos com o selo verde "T.I".
6. Ana e Carlos clicam no canal `Impressoras`. Ana relata um problema ("A impressora do
   2º andar não imprime") — Carlos vê; Bruno, que continua em Avisos, não vê.
   Na aba do Carlos, o canal `Impressoras` mostra a bolinha vermelha com a quantidade de
   mensagens aguardando resposta (abra outro canal no Carlos para ver o número subir);
   quando ele responde no canal, a bolinha some.
7. Na aba do Carlos, clique em "Ana" na lateral e responda em privado — só Ana recebe
   (marcado como "(privado)").
8. Para demonstrar o histórico: abra uma quarta aba, entre como outro técnico (ex:
   Diana, T.I) e clique em `Impressoras` — ela vê o relato da Ana sem ninguém repetir.
9. Feche uma das abas — as outras continuam funcionando normalmente e recebem o aviso
   `"X saiu do chat"` (a desconexão de um cliente não derruba os demais).

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
- *"Um colaborador consegue burlar e escrever em Avisos da T.I?"* → Não: mesmo
  mandando `MSG|...` direto pelo console do navegador, o servidor confere o `role` em
  `ClientHandler.handleMessage()` e responde `ERROR|somente_ti`.
- *"A senha da T.I é segura?"* → É uma senha fixa no código (`Server.TI_PASSWORD`),
  pensada só para a demonstração local. Num sistema real haveria cadastro de usuários
  e senhas armazenadas com hash.
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
