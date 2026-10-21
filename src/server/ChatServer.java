package server;

import java.io.IOException;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.concurrent.CopyOnWriteArrayList;

public class ChatServer {

    private static final int PORT = 12345;

    // Lista compartilhada entre threads: cada ClientHandler roda em sua própria thread,
    // mas todos precisam poder ler/escrever nessa lista para fazer o broadcast.
    private static final CopyOnWriteArrayList<ClientHandler> clients = new CopyOnWriteArrayList<>();

    public static void main(String[] args) {
        System.out.println("Servidor de chat iniciando na porta " + PORT + "...");

        try (ServerSocket serverSocket = new ServerSocket(PORT)) {
            System.out.println("Servidor pronto. Aguardando conexoes...");

            // Loop infinito: accept() bloqueia ate um cliente se conectar.
            // Cada conexao aceita gera uma nova thread, entao o loop volta
            // imediatamente para aceitar o proximo cliente.
            while (true) {
                Socket socket = serverSocket.accept();
                System.out.println("Novo cliente conectado: " + socket.getInetAddress());

                ClientHandler handler = new ClientHandler(socket, clients);
                clients.add(handler);

                Thread thread = new Thread(handler);
                thread.start();
            }
        } catch (IOException e) {
            System.err.println("Erro no servidor: " + e.getMessage());
        }
    }
}
