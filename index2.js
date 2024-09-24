const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const path = require("path");
const http = require("http");
const socketIo = require("socket.io");
const qrcode = require("qrcode");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*", // Configurar CORS según sea necesario
    methods: ["GET", "POST"],
  },
});

app.use(cors());
app.use(express.json());

// Función para inicializar el cliente de WhatsApp
let client;

// Evento de nueva conexión del cliente frontend
io.on("connection", (socket) => {
  console.log("Cliente conectado desde el frontend");

  // Emitimos un evento para informar que el cliente Socket.io está conectado
  socket.emit("connected", "Conectado al backend");

  socket.on("disconnect", () => {
    console.log("Cliente frontend desconectado");
  });
  socket.on("request-qr", () => {
    console.log("Solicitud de nuevo qr");
    // Inicializar el cliente
    client = new Client();

    client.on("qr", (qr) => {
      // Emitir el QR al cliente
      qrcode.toDataURL(qr, (err, url) => {
        if (err) {
          console.error("Error generando el código QR", err);
          return;
        }
        socket.emit("qr", url); // Emitimos el QR al frontend en tiempo real
      });
    });

    client.on("ready", () => {
      console.log("Cliente está listo!");
      socket.emit("ready", "Cliente está listo");
    });
    // Evento para detectar desconexión
    client.on("auth_failure", () => {
      console.log("Error de autenticación. Generando nuevo QR...");
      socket.emit("disconnected", "Desconectado. Generando nuevo QR...");
    });

    client.on("disconnected", (reason) => {
      console.log("Cliente desconectado:", reason);
      socket.emit("disconnected", "Desconectado. Generando nuevo QR...");
    });

    // Asegúrate de que la función donde usas 'await' sea async
    client.on("message", async (message) => {
      if (message.body.toLowerCase() === "fotos") {
        const imagePath = path.join(__dirname, "video.mp4");

        // Carga la imagen usando MessageMedia
        const media = MessageMedia.fromFilePath(imagePath);
        // Envía la imagen con una leyenda
        await client.sendMessage(message.from, media, {
          caption: "Aquí tienes la imagen que pediste!",
        });
      }
    });

    // Inicializar el cliente
    client.initialize();
  });
});

// Iniciar el servidor en el puerto 3001
server.listen(3001, () => {
  console.log("Servidor corriendo en http://localhost:3001");
});
