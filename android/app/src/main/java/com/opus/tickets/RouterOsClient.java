package com.opus.tickets;

import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

final class RouterOsClient {
    private RouterOsClient() {}

    static List<List<Map<String, String>>> run(
        String host,
        int port,
        String username,
        String password,
        List<List<String>> commands,
        int timeoutMs
    ) throws IOException {
        Socket socket = new Socket();
        try {
            socket.connect(new InetSocketAddress(host, port), timeoutMs);
            socket.setSoTimeout(timeoutMs);
            socket.setTcpNoDelay(true);
            OutputStream out = socket.getOutputStream();
            InputStream in = socket.getInputStream();
            List<List<String>> queue = new ArrayList<>();
            List<String> login = new ArrayList<>();
            login.add("/login");
            login.add("=name=" + username);
            login.add("=password=" + password);
            queue.add(login);
            queue.addAll(commands);
            List<List<Map<String, String>>> results = new ArrayList<>();
            for (List<String> sentence : queue) {
                out.write(encodeSentence(sentence));
                out.flush();
                List<Map<String, String>> rows = new ArrayList<>();
                while (true) {
                    List<String> words = readSentence(in);
                    if (words.isEmpty()) continue;
                    String kind = words.get(0);
                    if ("!re".equals(kind)) {
                        rows.add(toRecord(words));
                    } else if ("!done".equals(kind)) {
                        results.add(rows);
                        break;
                    } else if ("!trap".equals(kind) || "!fatal".equals(kind)) {
                        Map<String, String> info = toRecord(words);
                        String message = info.getOrDefault("message", "Le routeur a refusé la commande.");
                        if (message.toLowerCase().contains("invalid user name or password")) {
                            message = "Connexion au routeur refusée. Vérifiez l'utilisateur API et le mot de passe.";
                        }
                        throw new IOException(message);
                    }
                }
            }
            if (!results.isEmpty()) results.remove(0);
            return results;
        } catch (UnknownHostException error) {
            throw new IOException("Adresse du routeur introuvable.");
        } catch (java.net.ConnectException error) {
            throw new IOException("Impossible de joindre le routeur : le port API est fermé.");
        } catch (java.net.SocketTimeoutException error) {
            throw new IOException("Le routeur ne répond pas. Vérifiez l'adresse (Wi-Fi ou ZeroTier) et la connexion.");
        } catch (java.net.NoRouteToHostException | java.net.PortUnreachableException error) {
            throw new IOException("Impossible de joindre le routeur. Vérifiez l'adresse (Wi-Fi ou ZeroTier) et la connexion.");
        } finally {
            socket.close();
        }
    }

    private static Map<String, String> toRecord(List<String> words) {
        Map<String, String> record = new LinkedHashMap<>();
        for (String word : words) {
            if (!word.startsWith("=")) continue;
            int eq = word.indexOf('=', 1);
            if (eq < 0) continue;
            record.put(word.substring(1, eq), word.substring(eq + 1));
        }
        return record;
    }

    private static byte[] encodeSentence(List<String> words) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        for (String word : words) {
            byte[] body = word.getBytes(StandardCharsets.UTF_8);
            out.write(encodeLength(body.length));
            out.write(body);
        }
        out.write(0);
        return out.toByteArray();
    }

    private static byte[] encodeLength(int length) {
        if (length < 0x80) return new byte[] {(byte) length};
        if (length < 0x4000) return new byte[] {(byte) (((length >> 8) & 0xff) | 0x80), (byte) (length & 0xff)};
        if (length < 0x200000) {
            return new byte[] {
                (byte) (((length >> 16) & 0xff) | 0xc0),
                (byte) ((length >> 8) & 0xff),
                (byte) (length & 0xff)
            };
        }
        return new byte[] {
            (byte) (((length >> 24) & 0xff) | 0xe0),
            (byte) ((length >> 16) & 0xff),
            (byte) ((length >> 8) & 0xff),
            (byte) (length & 0xff)
        };
    }

    private static List<String> readSentence(InputStream in) throws IOException {
        List<String> words = new ArrayList<>();
        while (true) {
            int length = readLength(in);
            if (length == 0) return words;
            byte[] body = readFully(in, length);
            words.add(new String(body, StandardCharsets.UTF_8));
        }
    }

    private static byte[] readFully(InputStream in, int length) throws IOException {
        byte[] body = new byte[length];
        int offset = 0;
        while (offset < length) {
            int read = in.read(body, offset, length - offset);
            if (read < 0) throw new EOFException("La connexion au routeur a été coupée.");
            offset += read;
        }
        return body;
    }

    private static int readLength(InputStream in) throws IOException {
        int b0 = in.read();
        if (b0 < 0) throw new EOFException("La connexion au routeur a été coupée.");
        if ((b0 & 0x80) == 0) return b0;
        if ((b0 & 0xc0) == 0x80) return ((b0 & 0x3f) << 8) + readByte(in);
        if ((b0 & 0xe0) == 0xc0) return ((b0 & 0x1f) << 16) + (readByte(in) << 8) + readByte(in);
        if ((b0 & 0xf0) == 0xe0) {
            return ((b0 & 0x0f) * 16777216) + (readByte(in) << 16) + (readByte(in) << 8) + readByte(in);
        }
        if (b0 == 0xf0) {
            return (readByte(in) * 16777216) + (readByte(in) << 16) + (readByte(in) << 8) + readByte(in);
        }
        throw new IOException("Réponse du routeur illisible.");
    }

    private static int readByte(InputStream in) throws IOException {
        int value = in.read();
        if (value < 0) throw new EOFException("La connexion au routeur a été coupée.");
        return value;
    }
}
