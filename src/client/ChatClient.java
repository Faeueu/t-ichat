package client;

import javax.swing.*;
import java.awt.*;
import java.awt.event.ActionEvent;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import java.net.Socket;

public class ChatClient extends JFrame {

    private static final String SERVER_HOST = "localhost";
    private static final int SERVER_PORT = 12345;

    private final JTextArea messageArea = new JTextArea();
    private final JTextField inputField = new JTextField();
    private final JButton sendButton = new JButton("Enviar");

    private Socket socket;
    private BufferedReader in;
    private PrintWriter out;
    private String username;

    public ChatClient(String username) {
        super("Chat - " + username);
        this.username = username;

        buildInterface();
        conectar();
    }

    private void buildInterface() {
        messageArea.setEditable(false);
        messageArea.setLineWrap(true);

        JPanel bottomPanel = new JPanel(new BorderLayout());
        bottomPanel.add(inputField, BorderLayout.CENTER);
        bottomPanel.add(sendButton, BorderLayout.EAST);

        setLayout(new BorderLayout());
        add(new JScrollPane(messageArea), BorderLayout.CENTER);
        add(bottomPanel, BorderLayout.SOUTH);

        // Enviar tanto pelo botao quanto pela tecla Enter no campo de texto
        sendButton.addActionListener(this::enviarMensagem);
        inputField.addActionListener(this::enviarMensagem);

        setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);
        setSize(420, 500);
        setLocationRelativeTo(null);
    }

    private void conectar() {
        try {
            socket = new Socket(SERVER_HOST, SERVER_PORT);
            in = new BufferedReader(new InputStreamReader(socket.getInputStream()));
            out = new PrintWriter(socket.getOutputStream(), true);

            // Primeira linha enviada ao servidor = nome de usuario (combinado no protocolo do servidor)
            out.println(username);

            // Thread separada so para ouvir o servidor, pois readLine() bloqueia
            // e nao pode rodar na Event Dispatch Thread (trava a interface).
            Thread listenerThread = new Thread(this::ouvirServidor);
            listenerThread.setDaemon(true);
            listenerThread.start();

            appendMessage("Conectado ao servidor como " + username);
        } catch (IOException e) {
            appendMessage("Erro ao conectar: " + e.getMessage());
        }
    }

    private void ouvirServidor() {
        try {
            String mensagem;
            while ((mensagem = in.readLine()) != null) {
                String msgFinal = mensagem;
                // Qualquer atualizacao de componente Swing precisa acontecer na EDT.
                SwingUtilities.invokeLater(() -> appendMessage(msgFinal));
            }
        } catch (IOException e) {
            SwingUtilities.invokeLater(() -> appendMessage("Conexao com o servidor encerrada."));
        }
    }

    private void enviarMensagem(ActionEvent e) {
        String texto = inputField.getText().trim();
        if (!texto.isEmpty()) {
            out.println(texto);
            appendMessage("Voce: " + texto);
            inputField.setText("");
        }
    }

    private void appendMessage(String texto) {
        messageArea.append(texto + "\n");
    }

    public static void main(String[] args) {
        String username = JOptionPane.showInputDialog(null, "Digite seu nome de usuario:", "Entrar no chat", JOptionPane.PLAIN_MESSAGE);
        if (username == null || username.trim().isEmpty()) {
            username = "Usuario" + (int) (Math.random() * 1000);
        }
        final String finalUsername = username.trim();

        SwingUtilities.invokeLater(() -> new ChatClient(finalUsername).setVisible(true));
    }
}
