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

const clients = {}; // Almacenar los clientes de WhatsApp por clientId

// Evento de nueva conexión del cliente frontend
io.on("connection", (socket) => {
  console.log("Cliente conectado desde el frontend");
  // Reconectar si hay un clientId guardado en el frontend
  socket.on("reconnect-client", (clientId) => {
    if (clients[clientId]) {
      console.log(`Reutilizando cliente existente para ${clientId}`);
      socket.emit("ready", { clientId, message: "Cliente ya está listo" });
    } else {
      console.log(
        `No se encontró cliente para ${clientId}, generando nuevo QR.`
      );
      // Aquí puedes generar un nuevo QR si es necesario o manejar el error
      socket.emit("disconnected", { clientId });
    }
  });

  // Emitimos un evento para informar que el cliente Socket.io está conectado
  socket.emit("connected", "Conectado al backend");

  socket.on("disconnect", () => {
    console.log("Cliente frontend desconectado");
  });
  socket.on("request-qr", (clientId) => {
    console.log("Solicitud de nuevo qr");
    console.log(clientId);
    // Si ya hay un cliente para este clientId, lo desconectamos
    if (clients[clientId]) {
      // clients[clientId].destroy(); // Cierra el cliente existente
    }

    // Inicializar el cliente de WhatsApp para este clientId
    const client = new Client({
      authStrategy: new LocalAuth({ clientId }), // Usar LocalAuth con clientId
    });
    clients[clientId] = client; // Guardar cliente en el objeto clients

    client.on("qr", (qr) => {
      // Emitir el QR al cliente
      qrcode.toDataURL(qr, (err, url) => {
        if (err) {
          console.error("Error generando el código QR", err);
          return;
        }
        socket.emit("qr", { clientId, url }); // Emitimos el QR con el clientId
      });
    });

    client.on("ready", () => {
      console.log(`Cliente ${clientId} está listo!`);
      socket.emit("ready", { clientId, message: "Cliente está listo" });
    });

    client.on("disconnected", () => {
      console.log(`Cliente ${clientId} se ha desconectado.`);
      socket.emit("disconnected", { clientId });
      delete clients[clientId]; // Eliminar cliente del objeto clients
    });
    client.on("auth_failure", () => {
      console.log(`Error de autenticación. Generando nuevo QR...`);
      socket.emit("disconnected", { clientId });
      delete clients[clientId]; // Eliminar cliente del objeto clients
    });

    // Asegúrate de que la función donde usas 'await' sea async
    client.on("message", async (message) => {
      if (message.body.toLowerCase() === "fotos") {
        const imagePath = path.join(__dirname, "imagenes/1.jpg");

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
