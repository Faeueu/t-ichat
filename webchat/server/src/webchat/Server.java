package webchat;

import java.io.IOException;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

public class Server {

    private static final int PORT = 8080;

    // Salas fixas, simulando os canais de um chat interno de empresa. A primeira da
    // lista e' a sala padrao em que todo usuario entra ao conectar.
    static final String[] ROOMS = {"Geral", "Vendas", "TI", "RH"};

    // Quantas mensagens guardar por sala. Depois disso as mais antigas sao descartadas,
    // para o historico nao crescer sem limite durante a demonstracao.
    static final int HISTORY_LIMIT = 100;

    // Registro compartilhado: nome de usuario -> conexao (handler) daquele usuario.
    // ConcurrentHashMap permite leitura/escrita concorrente por varias threads (uma por
    // cliente conectado) sem precisar sincronizar manualmente cada acesso.
    static final ConcurrentHashMap<String, ClientHandler> clients = new ConcurrentHashMap<>();

    // Historico por sala: cada sala tem sua propria lista de mensagens ja formatadas
    // (prontas para reenviar como estao). CopyOnWriteArrayList e' seguro para ser lido
    // por uma thread enquanto outra adiciona uma mensagem nova.
    static final ConcurrentHashMap<String, List<String>> roomHistory = new ConcurrentHashMap<>();

    static {
        for (String room : ROOMS) {
            roomHistory.put(room, new CopyOnWriteArrayList<>());
        }
    }

    public static void main(String[] args) {
        System.out.println("Servidor de chat (web) iniciando na porta " + PORT + "...");
        System.out.println("Abra http://localhost:" + PORT + " no navegador.");

        try (ServerSocket serverSocket = new ServerSocket(PORT)) {
            // accept() bloqueia a thread principal ate um cliente (navegador) conectar.
            // Cada conexao vira uma Thread independente, entao o loop volta a aceitar
            // o proximo cliente imediatamente, sem esperar o anterior terminar.
            while (true) {
                Socket socket = serverSocket.accept();
                Thread thread = new Thread(new ClientHandler(socket, clients, roomHistory));
                thread.start();
            }
        } catch (IOException e) {
            System.err.println("Erro no servidor: " + e.getMessage());
        }
    }
}
