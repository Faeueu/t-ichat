# Guia de Arquitetura: WebSocket, Multithreading e Mensageria (Java Puro)

Este documento foi criado para explicar **em detalhes técnicos e didáticos** como funciona todo o código do projeto **Suporte T.I**, com ênfase especial em:
1. **Redes e Sockets puros em Java** (sem frameworks).
2. **Multithreading, concorrência e sincronização de dados**.
3. **Implementação manual do protocolo WebSocket (RFC 6455)**.
4. **Sistema de mensageria**, roteamento e broadcasting.
5. **Novas funcionalidades**: envio de arquivos/imagens/planilhas no privado e persistência de histórico local com LocalStorage e memória RAM.

---

## Sumário
1. [Visão Geral da Arquitetura](#1-visão-geral-da-arquitetura)
2. [Multithreading: Concorrência e Paralelismo](#2-multithreading-concorrência-e-paralelismo)
   - [O modelo Thread-per-Client](#o-modelo-thread-per-client)
   - [Estruturas de Dados Concorrentes](#estruturas-de-dados-concorrentes)
   - [Por que e onde usamos `synchronized`?](#por-que-e-onde-usamos-synchronized)
   - [Isolamento de Falhas](#isolamento-de-falhas)
3. [WebSocket por Baixo dos Panos (RFC 6455)](#3-websocket-por-baixo-dos-panos-rfc-6455)
   - [Fase 1: O Handshake HTTP inicial](#fase-1-o-handshake-http-inicial)
   - [Fase 2: Anatomia de um Frame Binário](#fase-2-anatomia-de-um-frame-binário)
   - [Máscara e Desmascaramento XOR](#máscara-e-desmascaramento-xor)
   - [Suporte a Fragmentação (Continuation Frames)](#suporte-a-fragmentação-continuation-frames)
4. [O Sistema de Mensageria e Protocolo](#4-o-sistema-de-mensageria-e-protocolo)
   - [Formato Delimitado por Pipes (`|`)](#formato-delimitado-por-pipes-)
   - [Roteamento de Canais Públicos vs Mensagens Privadas](#roteamento-de-canais-públicos-vs-mensagens-privadas)
5. [Envio de Arquivos, Imagens e Planilhas no Chat Privado](#5-envio-de-arquivos-imagens-e-planilhas-no-chat-privado)
   - [Como o arquivo viaja pelo WebSocket (Data URL / Base64)](#como-o-arquivo-viaja-pelo-websocket-data-url--base64)
   - [Categorização e Renderização no Front-End](#categorização-e-renderização-no-front-end)
6. [Persistência de Histórico: Solução para a Troca de Abas](#6-persistência-de-histórico-solução-para-a-troca-de-abas)
   - [Por que o histórico era apagado antes?](#por-que-o-histórico-era-apagado-antes)
   - [A Solução Híbrida: Memória RAM + LocalStorage](#a-solução-híbrida-memória-ram--localstorage)
7. [Rastreamento de um Fluxo Completo (Passo a Passo)](#7-rastreamento-de-um-fluxo-completo-passo-a-passo)

---

## 1. Visão Geral da Arquitetura

O sistema é composto por duas partes:
- **Back-end**: Java SE puro (utilizando apenas as bibliotecas padrão `java.net`, `java.io`, `java.util.concurrent`, `java.security`). Não há Tomcat, Jetty, Netty ou Spring.
- **Front-end**: HTML5, CSS3 e JavaScript Vanilla (sem React, Vue, jQuery ou bibliotecas externas).

```
+-----------------------------------------------------------------------------------+
|                                 NAVEGADORES WEB                                   |
|  [ Aba 1: Carlos (T.I) ]         [ Aba 2: Ana ]          [ Aba 3: Bruno ]         |
+------------+---------------------------+------------------------+-----------------+
             |                           |                        |
             | WebSocket bidirecional    |                        |
             | ws://localhost:8080/ws    |                        |
             v                           v                        v
+-----------------------------------------------------------------------------------+
|                                 SERVIDOR JAVA                                     |
|  ServerSocket.accept() ──> Cria 1 Thread dedicada para cada conexão               |
|                                                                                   |
|  +--------------------+   +--------------------+   +--------------------+         |
|  | Thread 1 (Carlos)  |   | Thread 2 (Ana)     |   | Thread 3 (Bruno)   |         |
|  | ClientHandler      |   | ClientHandler      |   | ClientHandler      |         |
|  +---------+----------+   +---------+----------+   +---------+----------+         |
|            |                        |                        |                    |
|            +------------------------+------------------------+                    |
|                                     |                                             |
|                                     v                                             |
|        [ Estado Compartilhado em Memória Thread-Safe ]                            |
|        - clients: ConcurrentHashMap<String, ClientHandler>                        |
|        - roomHistory: ConcurrentHashMap<String, List<String>>                     |
|        - pendingReplies: ConcurrentHashMap<String, Integer>                       |
+-----------------------------------------------------------------------------------+
```

---

## 2. Multithreading: Concorrência e Paralelismo

### O modelo Thread-per-Client

No arquivo `Server.java`:
```java
ServerSocket serverSocket = new ServerSocket(PORT);
while (true) {
    Socket socket = serverSocket.accept(); // 1. Bloqueia até um cliente conectar
    Thread thread = new Thread(new ClientHandler(socket, clients, roomHistory)); // 2. Cria thread
    thread.start(); // 3. Dispara a thread independente
}
```

- **I/O Bloqueante**: Quando uma thread executa `socket.getInputStream().read()`, ela entra em estado de espera (bloqueada pelo sistema operacional) até que bytes cheguem pela rede.
- **Por que uma thread por cliente?** Se usássemos apenas uma thread, quando o cliente 1 ficasse ocioso, o servidor ficaria travado esperando dados dele e **nenhum outro cliente conseguiria conectar ou trocar mensagens**. Com uma thread por cliente, cada conexão roda em paralelo no processador.

---

### Estruturas de Dados Concorrentes

Como várias threads estão ativas ao mesmo tempo, elas precisam compartilhar informações (ex.: quem está online, histórico de mensagens). Usar um `HashMap` ou `ArrayList` comum causaria **Race Conditions** e corrupção de memória.

1. **`ConcurrentHashMap<String, ClientHandler> clients`**:
   - O `ConcurrentHashMap` divide os dados em segmentos (locks granulares). Diferentes threads podem ler e escrever ao mesmo tempo sem travar o mapa inteiro.
   - Uso de métodos atômicos como `clients.putIfAbsent(desiredName, this)`: se dois usuários tentarem entrar com o nome `"Carlos"` exatamente no mesmo milissegundo, a operação é atômica no nível da CPU: um registrará com sucesso e o outro receberá erro de `nome_em_uso`.

2. **`CopyOnWriteArrayList<String>` no Histórico de Salas**:
   - Usado em `roomHistory`. Permite que uma thread faça broadcast e itere pelas mensagens enquanto outra adiciona uma nova mensagem, sem disparar `ConcurrentModificationException`.

---

### Por que e onde usamos `synchronized`?

O `synchronized` cria uma **seção crítica** onde apenas uma thread pode entrar por vez. Usamos em dois pontos vitais:

#### 1. Envio de Frames no Socket (`ClientHandler.send`):
```java
void send(String payload) {
    try {
        synchronized (out) { // Garante exclusão mútua no OutputStream
            WebSocketCodec.sendTextFrame(out, payload);
        }
    } catch (IOException e) { ... }
}
```
**O Problema**: Imagine que a Thread A está enviando uma imagem de 1 MB para o cliente X. Ao mesmo tempo, a Thread B quer enviar um aviso de sistema `USERS|...` para o mesmo cliente X. Se ambas gravassem em `out` simultaneamente sem sincronização, os bytes das duas mensagens se misturariam no cabo de rede, corrompendo o frame binário e derrubando a conexão. O `synchronized (out)` garante que cada frame saia de forma íntegra.

#### 2. Contador de Mensagens Pendentes e Histórico (`saveToHistory`):
```java
synchronized (history) {
    history.add(payload);
    if (history.size() > Server.HISTORY_LIMIT) {
        history.remove(0);
    }
    int pending = role.equals("TI") ? 0 : pendingReplies.get(room) + 1;
    pendingReplies.put(room, pending);
    return pending;
}
```
Garante que a adição ao histórico e o incremento do contador ocorram como uma transação única (atômica).

---

### Isolamento de Falhas

Cada cliente roda dentro do seu próprio bloco de proteção em `ClientHandler.java`:
```java
try {
    chatLoop();
} catch (IOException e) {
    System.out.println("Conexao encerrada: " + e.getMessage());
} finally {
    disconnect(); // Remove do mapa clients e avisa os outros (LEAVE)
    closeSocket();
}
```
Se uma aba for fechada abruptamente, a placa de rede do cliente cair ou o navegador travar, **apenas a thread daquele cliente sofre exceção**. Ela executa o `finally`, se desconecta, fecha o socket e as demais dezenas de threads de outros usuários continuam operando normalmente sem interrupção.

---

## 3. WebSocket por Baixo dos Panos (RFC 6455)

Bibliotecas prontas como Socket.IO ou Spring escondem toda a complexidade do WebSocket. Neste projeto, ele foi construído do zero lendo e escrevendo bytes em streams brutos.

### Fase 1: O Handshake HTTP inicial

O WebSocket começa como uma requisição HTTP comum na porta 8080:
```http
GET /ws HTTP/1.1
Host: localhost:8080
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
Sec-WebSocket-Version: 13
```

Para aceitar a conexão, o servidor precisa provar que entende a RFC 6455:
1. Pega a chave enviada pelo navegador (`Sec-WebSocket-Key`).
2. Concatena com um GUID padrão universal fixado pela RFC: `258EAFA5-E914-47DA-95CA-C5AB0DC85B11`.
3. Calcula o hash criptográfico **SHA-1** dessa combinação.
4. Converte o resultado em **Base64**.
5. Retorna o status HTTP `101 Switching Protocols`:

```java
// Implementado em WebSocketCodec.java
String concatenated = secWebSocketKey + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
MessageDigest sha1 = MessageDigest.getInstance("SHA-1");
byte[] hash = sha1.digest(concatenated.getBytes(StandardCharsets.UTF_8));
String acceptKey = Base64.getEncoder().encodeToString(hash);
```

Após o envio desse cabeçalho HTTP 101, o protocolo HTTP "morre" e a conexão TCP permanece aberta para tráfego binário contínuo em frames WebSocket.

---

### Fase 2: Anatomia de um Frame Binário

Todo dado transmitido segue a seguinte estrutura de bytes:

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-------+-+-------------+-------------------------------+
|F|R|R|R| opcode|M| Payload len |    Extended payload length    |
|I|S|S|S|  (4)  |A|     (7)     |             (16/64)           |
|N|V|V|V|       |S|             |   (se payload len == 126/127) |
| |1|2|3|       |K|             |                               |
+-+-+-+-+-------+-+-------------+ - - - - - - - - - - - - - - - +
|     Masking-key (4 bytes, presente apenas se MASK == 1)       |
+---------------------------------------------------------------+
|                     Payload Data (dados reais)                |
+---------------------------------------------------------------+
```

- **FIN (1 bit)**: `1` significa que o frame é o último (ou único) da mensagem. `0` significa que mais frames virão (fragmentação).
- **Opcode (4 bits)**:
  - `0x1`: Texto UTF-8.
  - `0x0`: Frame de continuação (continuation frame).
  - `0x8`: Fechamento de conexão (close frame).
  - `0x9` e `0xA`: Ping e Pong (heartbeat).
- **Payload Len (7 bits)**:
  - Se `<=` 125: esse é o tamanho exato.
  - Se `== 126`: os próximos 2 bytes indicam o tamanho (uint16, até 64 KB).
  - Se `== 127`: os próximos 8 bytes indicam o tamanho (uint64, para arquivos grandes de vários megabytes).

---

### Máscara e Desmascaramento XOR

A RFC 6455 exige que **todo frame enviado pelo navegador para o servidor seja mascarado** com uma chave aleatória de 4 bytes (para evitar ataques de cache poisoning em proxies intermediários).

O servidor lê os 4 bytes da máscara e recupera os bytes originais usando a operação lógica **XOR (`^`)**:

```java
// Em WebSocketCodec.java
for (int i = 0; i < payload.length; i++) {
    payload[i] = (byte) (payload[i] ^ mask[i % 4]);
}
```
> **Propriedade do XOR**: `(A ^ B) ^ B = A`. Como o navegador aplicou XOR com a máscara, aplicar o XOR novamente revela o byte exato original!

Frames que saem do **servidor para o navegador não usam máscara**.

---

### Suporte a Fragmentação (Continuation Frames)

Quando enviamos mensagens grandes (como uma foto ou planilha de 2 MB), os navegadores dividem a mensagem em múltiplos pedaços (geralmente chunks de 32 KB ou 64 KB):
1. **Primeiro frame**: `FIN=0`, `Opcode=0x1` (Texto).
2. **Frames intermediários**: `FIN=0`, `Opcode=0x0` (Continuação).
3. **Último frame**: `FIN=1`, `Opcode=0x0` (Continuação com fim de mensagem).

Em `WebSocketCodec.java`, implementamos um buffer agregador (`ByteArrayOutputStream assembled`) que lê e concatena todos os fragmentos até que `FIN == 1`, entregando a mensagem completa ao `ClientHandler`.

---

## 4. O Sistema de Mensageria e Protocolo

### Formato Delimitado por Pipes (`|`)

Em vez de incluir bibliotecas pesadas de JSON (como Jackson ou Gson), o protocolo utiliza mensagens de texto plano separadas por pipe `|`:

```text
COMANDO|campo1|campo2|campo3...
```

Vantagens:
- **Zero dependências externas**.
- Fácil de inspecionar no console de rede do navegador.
- Parsing extremamente rápido com `String.split("\\|", limite)`.

---

### Roteamento de Canais Públicos vs Mensagens Privadas

| Tipo | Fluxo | Escopo |
|---|---|---|
| **Público (`MSG`)** | Cliente ➔ Servidor ➔ Broadcast para quem tem `currentRoom == sala` | Roteada apenas aos usuários presentes no mesmo canal. Salva no histórico da sala. |
| **Privado (`PRIVATE`)** | Cliente ➔ Servidor ➔ Entrega direta ao destinatário + eco ao remetente | Roteada exclusivamente entre os dois envolvidos. Não interfere nos canais públicos. |
| **Arquivo Privado (`PRIVATE_FILE`)** | Cliente ➔ Servidor ➔ Entrega de anexo e dados Base64 ao destinatário + eco | Exclusivo para chat privado. |

---

## 5. Envio de Arquivos, Imagens e Planilhas no Chat Privado

### Como o arquivo viaja pelo WebSocket (Data URL / Base64)

Para manter o princípio de **sem banco de dados e sem persistência em disco** (como especificado nos requisitos do projeto), o arquivo não é gravado no disco do servidor. Ele viaja diretamente como uma **Data URL**:

1. No Front-End, o usuário seleciona um arquivo (ex.: `relatorio.xlsx` de 150 KB).
2. O JavaScript usa a API nativa `FileReader`:
   ```javascript
   const reader = new FileReader();
   reader.readAsDataURL(file); // Converte para "data:application/vnd.ms-excel;base64,UEsDBBQ..."
   ```
3. A string Base64 resultante contém o tipo MIME e todos os dados binários codificados em caracteres ASCII seguros.
4. O cliente envia via WebSocket:
   ```text
   PRIVATE_FILE|Carlos|relatorio.xlsx|data:application/...;base64,...|Segue a planilha
   ```
5. O servidor recebe essa mensagem como frame de texto e a encaminha ao destinatário `Carlos` e ao remetente.

---

### Categorização e Renderização no Front-End

No arquivo `app.js`, a função `classifyFile(filename, dataUrl)` analisa a extensão e o MIME type:

- **Imagens** (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`):
  Renderiza uma miniatura inline (`<img class="chat-image-preview">`). Ao clicar na miniatura, a imagem é aberta em resolução cheia em uma nova janela.
- **Planilhas** (`.xlsx`, `.xls`, `.csv`, `.ods`):
  Renderiza um card com destaque verde, ícone `📊`, badge **PLANILHA**, exibição do tamanho formatado (ex.: `245 KB`) e botão de download `⬇ Baixar`.
- **Outros Documentos** (`.pdf`, `.docx`, `.txt`, `.zip`):
  Renderiza um card com destaque roxo, ícone `📄`, badge **ARQUIVO** e botão de download.

O download é instantâneo via HTML5 utilizando o atributo `download`:
```html
<a href="data:..." download="relatorio.xlsx" class="attachment-download-btn">⬇ Baixar</a>
```

---

## 6. Persistência de Histórico: Solução para a Troca de Abas

### Por que o histórico era apagado antes?

Originalmente, o servidor controlava apenas o histórico das salas públicas (`roomHistory`). Quando um usuário clicava em um canal diferente (ex.: `# Sistemas`), o servidor disparava o evento `HISTORY_BEGIN|Sistemas`, e o JavaScript executava:

```javascript
messageLogEl.innerHTML = ''; // Limpava toda a tela para desenhar a nova sala
```

Como as mensagens privadas ficavam apenas desenhadas temporariamente no DOM da tela e **não eram salvas em nenhuma estrutura de dados do front-end**, ao limpar a tela todas as mensagens e fotos privadas eram permanentemente perdidas.

---

### A Solução Híbrida: Memória RAM + LocalStorage

Implementamos uma arquitetura de persistência em dois níveis no `app.js`:

```javascript
// 1. Memoria RAM (objeto em memoria durante a sessao)
const privateHistories = {}; // Chave: nome do outro usuario -> Array de mensagens

// 2. Chave isolada por usuario no LocalStorage
function getStorageKey(targetUser) {
    return 'tichat_priv_' + myUsername + '_' + targetUser;
}
```

#### O Ciclo de Vida:
1. **Envio ou Recebimento**:
   Quando qualquer mensagem privada (`PRIVATE`) ou arquivo (`PRIVATE_FILE`) chega, ela é adicionada à lista em memória:
   ```javascript
   const history = loadPrivateHistory(otherUser);
   history.push(item);
   savePrivateHistory(otherUser); // Salva no LocalStorage
   ```
2. **Troca de Canal/Aba**:
   Se você estiver conversando com o Carlos, enviar uma foto e depois clicar no canal `# Impressoras`:
   - A tela é limpa e exibe o canal `# Impressoras`.
   - As mensagens e a foto com o Carlos continuam 100% salvas em `privateHistories['Carlos']` e no `localStorage`.
3. **Retorno ao Chat Privado**:
   Ao clicar novamente em "Carlos" na lista de usuários da barra lateral:
   - A função `switchToPrivate('Carlos')` é chamada.
   - A tela é limpa e `renderPrivateChat('Carlos')` reconstrói todas as mensagens, textos, imagens e cards de download exatamente como estavam.
4. **Proteção de Quota**:
   O `localStorage` possui limite de ~5 MB a 10 MB. Se muitas fotos forem trocadas e o limite for atingido, a função captura o erro silenciosamente via `try/catch` e mantém o histórico seguro na memória RAM durante toda a sessão.

---

## 7. Rastreamento de um Fluxo Completo (Passo a Passo)

Para entender como tudo se conecta, acompanhe o que acontece quando **Ana envia uma foto privada para Carlos**:

```
[Ana: Navegador]
  1. Ana clica em "Carlos" na barra lateral.
  2. O front-end ativa modo privado: activeView = { type: 'private', id: 'Carlos' }.
  3. Ana clica no botao 📎 e escolhe "print_erro.png".
  4. O FileReader converte o arquivo para Base64 (data:image/png;base64,...).
  5. Ana digita "Veja o erro" e clica em Enviar.
  6. O navegador envia frame WebSocket pela conexao TCP:
     PRIVATE_FILE|Carlos|print_erro.png|data:image/png;base64,...|Veja o erro

[Servidor Java: Thread da Ana]
  7. ClientHandler.chatLoop() desbloqueia no readTextFrame().
  8. WebSocketCodec decodifica o frame e desfaz a mascara XOR.
  9. ClientHandler identifica comando "PRIVATE_FILE".
 10. Localiza o destinatario no mapa: ClientHandler target = clients.get("Carlos").
 11. Monta o payload definitivo com timestamp do servidor:
     PRIVATE_FILE|Ana|Carlos|COLABORADOR|1729900000000|print_erro.png|data:...|Veja o erro
 12. target.send(payload) -> envia para o Carlos (sincronizado em target.out).
 13. this.send(payload)   -> ecoa para a Ana (para ela ver o que enviou).

[Carlos: Navegador]
 14. O WebSocket do Carlos recebe a mensagem em handleServerMessage().
 15. Identifica que a conversa pertence a "Ana" (otherUser).
 16. Salva no privateHistories['Ana'] e no LocalStorage.
 17. Se Carlos estiver com o chat da Ana aberto na tela:
     - Renderiza a imagem e o texto instantaneamente.
 18. Se Carlos estiver no canal #Sistemas:
     - Incrementa a bolinha vermelha de notificacao ao lado do nome da Ana na barra lateral.
     - Exibe aviso de sistema na tela alertando sobre a nova mensagem privada.
```

---

## 8. Conclusão

Este projeto demonstra na prática os fundamentos que sustentam qualquer servidor de alta performance moderno:
- **Sockets brutos**: controle total de bytes e pacotes TCP sem abstrações mágicas.
- **RFC 6455 manual**: como navegadores e servidores negociam upgrades de protocolo e trocam dados binários em tempo real.
- **Multithreading real**: como gerenciar concorrência, evitar deadlocks e proteger memória compartilhada com sincronização cuidadosa.
- **Single-Page Application (SPA) reativa com Vanilla JS**: roteamento de visualizações em memória, streaming de arquivos via Base64 e persistência resiliente com LocalStorage.
