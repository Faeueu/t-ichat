package webchat;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Socket;
import java.security.NoSuchAlgorithmException;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Uma instancia desta classe roda em sua propria Thread para cada navegador conectado.
 * Ela cuida de 3 fases, todas sobre o MESMO Socket:
 *   1) ler a requisicao HTTP inicial (linha + headers) via Streams brutos;
 *   2) se for "/ws", faz o handshake do WebSocket e passa a trocar frames binarios;
 *      caso contrario, serve um arquivo estatico (HTML/CSS/JS) e encerra a conexao.
 *   3) apos o handshake, fica em loop lendo mensagens de texto do protocolo da aplicacao.
 */
public class ClientHandler implements Runnable {

    private final Socket socket;
    private final ConcurrentHashMap<String, ClientHandler> clients;
    private final ConcurrentHashMap<String, List<String>> roomHistory;

    private InputStream in;
    private OutputStream out;
    private String username;

    // Server.ROLE_TI ou Server.ROLE_COLABORADOR. Definido antes de entrar no mapa
    // "clients", para que outras threads ja o encontrem preenchido.
    private String role;

    // Em qual sala este cliente esta "olhando" agora. So existe depois do HELLO,
    // por isso comeca null; broadcast(..) usa isso para decidir quem recebe cada MSG.
    private volatile String currentRoom;

    public ClientHandler(Socket socket, ConcurrentHashMap<String, ClientHandler> clients,
                          ConcurrentHashMap<String, List<String>> roomHistory) {
        this.socket = socket;
        this.clients = clients;
        this.roomHistory = roomHistory;
    }

    @Override
    public void run() {
        try {
            in = socket.getInputStream();
            out = socket.getOutputStream();

            String[] requestLine = WebSocketCodec.readRequestLine(in);
            if (requestLine == null) {
                return;
            }
            String path = requestLine[1];
            Map<String, String> headers = WebSocketCodec.readHeaders(in);

            if (!"/ws".equals(path)) {
                StaticFileServer.serve(path, out);
                return;
            }

            if (!doHandshake(headers)) {
                return;
            }

            chatLoop();
        } catch (IOException | NoSuchAlgorithmException e) {
            System.out.println("Conexao encerrada com erro: " + e.getMessage());
            e.printStackTrace();
        } finally {
            disconnect();
            closeSocket();
        }
    }

    private boolean doHandshake(Map<String, String> headers) throws IOException, NoSuchAlgorithmException {
        String key = headers.get("sec-websocket-key");
        if (key == null) {
            return false; // nao era uma requisicao de upgrade para WebSocket valida
        }
        String acceptKey = WebSocketCodec.computeAcceptKey(key);
        WebSocketCodec.sendHandshakeResponse(out, acceptKey);
        return true;
    }

    private void chatLoop() throws IOException {
        // Primeira mensagem esperada do cliente, por protocolo: HELLO|<username>|<papel>|<senha>
        String hello = WebSocketCodec.readTextFrame(in);
        if (hello == null || !hello.startsWith("HELLO|")) {
            return;
        }
        String[] parts = hello.split("\\|", 4);
        String desiredName = parts.length > 1 ? parts[1].trim() : "";
        String desiredRole = parts.length > 2 ? parts[2].trim() : "";
        String password = parts.length > 3 ? parts[3] : "";

        if (desiredName.isEmpty()) {
            desiredName = "Usuario" + (int) (Math.random() * 1000);
        }
        // "," e ":" sao separadores da lista USERS, entao nao podem aparecer no nome.
        if (desiredName.contains(",") || desiredName.contains(":")) {
            WebSocketCodec.sendTextFrame(out, "ERROR|nome_invalido");
            return;
        }
        if (Server.ROLE_TI.equals(desiredRole)) {
            if (!Server.TI_PASSWORD.equals(password)) {
                WebSocketCodec.sendTextFrame(out, "ERROR|senha_invalida");
                return;
            }
        } else if (!Server.ROLE_COLABORADOR.equals(desiredRole)) {
            WebSocketCodec.sendTextFrame(out, "ERROR|papel_invalido");
            return;
        }
        role = desiredRole;

        // putIfAbsent e' atomico: evita que duas threads registrem o mesmo nome ao mesmo tempo.
        if (clients.putIfAbsent(desiredName, this) != null) {
            WebSocketCodec.sendTextFrame(out, "ERROR|nome_em_uso");
            return;
        }
        username = desiredName;

        WebSocketCodec.sendTextFrame(out, "WELCOME|" + username + "|" + role);
        send("ROOMS|" + String.join(",", Server.ROOMS));
        send("ANNOUNCEMENTS|" + Server.ANNOUNCEMENTS_ROOM);
        if (Server.ROLE_TI.equals(role)) {
            for (String room : Server.ROOMS) {
                send("PENDING|" + room + "|" + Server.pendingReplies.get(room));
            }
        }
        broadcastGlobal("JOIN|" + username + "|" + role);
        broadcastUserList();

        joinRoom(Server.ROOMS[0]); // toda conexao nova comeca na sala padrao ("Geral")

        String message;
        // readTextFrame bloqueia esta thread ate chegar a proxima mensagem (ou a conexao cair).
        // Como cada cliente roda em sua propria thread, isso nao afeta os demais usuarios.
        while ((message = WebSocketCodec.readTextFrame(in)) != null) {
            handleMessage(message);
        }
    }

    private void handleMessage(String message) {
        if (message.startsWith("MSG|")) {
            // O canal de avisos e' so' leitura para colaboradores; a regra fica no servidor
            // para nao depender apenas do bloqueio feito na interface.
            if (Server.ANNOUNCEMENTS_ROOM.equals(currentRoom) && !Server.ROLE_TI.equals(role)) {
                send("ERROR|somente_ti");
                return;
            }
            String text = message.substring("MSG|".length());
            String payload = "MSG|" + currentRoom + "|" + username + "|" + role + "|" + System.currentTimeMillis() + "|" + text;
            String room = currentRoom;
            int pending = saveToHistory(room, payload);
            broadcastToRoom(room, payload);
            broadcastToTi("PENDING|" + room + "|" + pending);
        } else if (message.startsWith("JOIN_ROOM|")) {
            String room = message.substring("JOIN_ROOM|".length()).trim();
            joinRoom(room);
        } else if (message.startsWith("PRIVATE|")) {
            String[] parts = message.split("\\|", 3);
            if (parts.length < 3) {
                return;
            }
            String to = parts[1];
            String text = parts[2];
            ClientHandler target = clients.get(to);
            String payload = "PRIVATE|" + username + "|" + role + "|" + System.currentTimeMillis() + "|" + text;
            if (target != null) {
                target.send(payload);
                this.send(payload); // ecoa para o proprio remetente ver a mensagem enviada
            } else {
                this.send("ERROR|usuario_offline");
            }
        } else if (message.startsWith("PRIVATE_FILE|")) {
            // Envio de arquivos, imagens e planilhas exclusivo para chat privado:
            // PRIVATE_FILE|<destinatario>|<filename>|<dataUrl>|<textoOpcional>
            String[] parts = message.split("\\|", 5);
            if (parts.length < 4) {
                return;
            }
            String to = parts[1];
            String filename = parts[2].replace('|', '_');
            String dataUrl = parts[3];
            String text = parts.length > 4 ? parts[4] : "";

            ClientHandler target = clients.get(to);
            String payload = "PRIVATE_FILE|" + username + "|" + role + "|" + System.currentTimeMillis() + "|" + filename + "|" + dataUrl + "|" + text;
            if (target != null) {
                target.send(payload);
                this.send(payload); // ecoa para o proprio remetente
            } else {
                this.send("ERROR|usuario_offline");
            }
        }
    }

    // Troca a sala ativa do usuario e reenvia o historico dela, para que tanto quem
    // acabou de conectar quanto quem so' esta trocando de canal veja as mensagens
    // anteriores (requisito de "novos integrantes verem o historico").
    private void joinRoom(String room) {
        List<String> history = roomHistory.get(room);
        if (history == null) {
            send("ERROR|sala_invalida");
            return;
        }
        currentRoom = room;
        send("HISTORY_BEGIN|" + room);
        for (String storedMessage : history) {
            send(storedMessage);
        }
        send("HISTORY_END|" + room);
    }

    // Salva a mensagem e atualiza o contador de pendentes da sala no mesmo bloco
    // synchronized, para que mensagens simultaneas nao percam contagem. Retorna o novo total.
    private int saveToHistory(String room, String payload) {
        List<String> history = roomHistory.get(room);
        synchronized (history) {
            history.add(payload);
            while (history.size() > Server.HISTORY_LIMIT) {
                history.remove(0);
            }
            int pending = Server.ROLE_TI.equals(role) ? 0 : Server.pendingReplies.get(room) + 1;
            Server.pendingReplies.put(room, pending);
            return pending;
        }
    }

    private void broadcastToRoom(String room, String payload) {
        for (ClientHandler client : clients.values()) {
            if (room.equals(client.currentRoom)) {
                client.send(payload);
            }
        }
    }

    private void broadcastToTi(String payload) {
        for (ClientHandler client : clients.values()) {
            if (Server.ROLE_TI.equals(client.role)) {
                client.send(payload);
            }
        }
    }

    private void broadcastGlobal(String payload) {
        for (ClientHandler client : clients.values()) {
            client.send(payload);
        }
    }

    // Formato: USERS|nome:papel,nome:papel,... (o papel permite separar T.I de colaboradores na tela)
    private void broadcastUserList() {
        StringBuilder list = new StringBuilder();
        for (Map.Entry<String, ClientHandler> entry : clients.entrySet()) {
            if (list.length() > 0) {
                list.append(',');
            }
            list.append(entry.getKey()).append(':').append(entry.getValue().role);
        }
        broadcastGlobal("USERS|" + list);
    }

    void send(String payload) {
        try {
            synchronized (out) {
                WebSocketCodec.sendTextFrame(out, payload);
            }
        } catch (IOException e) {
            // conexao desse cliente ja pode ter caido; a propria thread dele vai detectar
            // isso no proximo readTextFrame() e fazer a limpeza via disconnect().
        }
    }

    private void disconnect() {
        if (username != null) {
            clients.remove(username);
            broadcastGlobal("LEAVE|" + username + "|" + role);
            broadcastUserList();
        }
    }

    private void closeSocket() {
        try {
            socket.close();
        } catch (IOException e) {
            // socket ja pode estar fechado
        }
    }
}
