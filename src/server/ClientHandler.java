package server;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import java.net.Socket;
import java.util.List;

public class ClientHandler implements Runnable {

    private final Socket socket;
    private final List<ClientHandler> clients;

    private BufferedReader in;
    private PrintWriter out;
    private String username;

    public ClientHandler(Socket socket, List<ClientHandler> clients) {
        this.socket = socket;
        this.clients = clients;
    }

    @Override
    public void run() {
        try {
            in = new BufferedReader(new InputStreamReader(socket.getInputStream()));
            out = new PrintWriter(socket.getOutputStream(), true);

            // Protocolo simples: a primeira linha que o cliente envia e' o nome de usuario.
            username = in.readLine();
            if (username == null) {
                username = "Anonimo";
            }
            System.out.println(username + " entrou no chat.");
            broadcast("SISTEMA: " + username + " entrou no chat.", this);

            String message;
            // readLine() bloqueia esta thread ate chegar uma linha nova ou o cliente desconectar
            // (nesse caso retorna null). Como cada cliente tem sua propria thread, isso nao trava
            // os demais clientes.
            while ((message = in.readLine()) != null) {
                System.out.println(username + ": " + message);
                broadcast(username + ": " + message, this);
            }
        } catch (IOException e) {
            System.out.println("Conexao perdida com " + username);
        } finally {
            disconnect();
        }
    }

    private void broadcast(String message, ClientHandler sender) {
        for (ClientHandler client : clients) {
            if (client != sender) {
                client.send(message);
            }
        }
    }

    public void send(String message) {
        out.println(message);
    }

    private void disconnect() {
        clients.remove(this);
        try {
            socket.close();
        } catch (IOException e) {
            // socket ja pode estar fechado, nao ha o que fazer aqui
        }
        if (username != null) {
            System.out.println(username + " saiu do chat.");
            broadcast("SISTEMA: " + username + " saiu do chat.", this);
        }
    }
}
