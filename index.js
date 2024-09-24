const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const express = require("express");
const cors = require("cors");
const qrcode = require("qrcode-terminal");
const fs = require("fs");
const path = require("path");
const socketIo = require("socket.io");

// Configuración inicial
const app = express();
app.use(cors());

const server = app.listen(3001, () => {
  console.log("Servidor corriendo en el puerto 3001");
});

const io = socketIo(server);

let client = null; // Cliente de WhatsApp se inicializa cuando sea necesario
let qrCodeImage = null;
let sessionActive = false;

// Función para inicializar el cliente de WhatsApp
const initializeClient = () => {
  client = new Client({
    authStrategy: new LocalAuth(),
  });

  // Escuchar el evento 'qr' para enviar el código QR al frontend
  client.on("qr", (qr) => {
    console.log("Generando código QR...");
    qrCodeImage = qr; // Guardamos el QR
    io.emit("qr", qr); // Enviamos el QR al frontend
  });

  // Cuando se haya autenticado correctamente
  client.on("ready", () => {
    console.log("Cliente listo!");
    qrCodeImage = null; // Limpiamos el QR ya que no es necesario más
    sessionActive = true;
    io.emit("ready"); // Notificar al frontend que la sesión está lista
  });

  // Si la sesión se desconecta
  client.on("disconnected", () => {
    console.log("Cliente desconectado!");
    sessionActive = false;
    io.emit("disconnected"); // Notificar al frontend que la sesión se ha desconectado
  });

  // Iniciar el cliente de WhatsApp
  client.initialize();
};

// Escuchar el evento desde el frontend para solicitar un nuevo QR
io.on("connection", (socket) => {
  socket.on("request-qr", () => {
    console.log("Solicitud de nuevo código QR recibida...");
    qrCodeImage = null; // Reseteamos cualquier QR previo
    if (!client) {
      initializeClient(); // Inicializamos el cliente solo cuando se solicite
    } else {
      client.initialize(); // Reiniciar el cliente si ya existe pero necesita un nuevo QR
    }
  });
});

// Ruta para verificar si ya existe una sesión o un QR disponible
app.get("/check-session", (req, res) => {
  if (sessionActive) {
    res.json({ session: true });
  } else if (qrCodeImage) {
    res.json({ qr: qrCodeImage });
  } else {
    res.json({ message: "No hay QR generado ni sesión activa" });
  }
});

// Escuchar mensajes entrantes
app.get("/test", (req, res) => {
  res.send("Servidor funciona correctamente.");
});

client?.on("message", async (msg) => {
  if (msg.body.toLowerCase() === "fotos") {
    const imagesDir = path.join(__dirname, "imagenes");
    fs.readdir(imagesDir, (err, files) => {
      if (err) {
        console.error("Error leyendo la carpeta de imágenes", err);
        return;
      }

      files.forEach((file) => {
        const filePath = path.join(imagesDir, file);
        const media = MessageMedia.fromFilePath(filePath);
        client.sendMessage(msg.from, media);
      });
    });
  }
});
