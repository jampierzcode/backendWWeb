const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const axios = require("axios");
const qs = require("qs");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const path = require("path");
const http = require("http");
const socketIo = require("socket.io");
const qrcode = require("qrcode");
const dayjs = require("dayjs");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.use(cors());
app.use(express.json());

const clients = {}; // Almacenar los clientes de WhatsApp por clientId

// Función para inicializar un cliente de WhatsApp
const initializeClient = (clientId) => {
  const client = new Client({
    authStrategy: new LocalAuth({ clientId }), // Usar LocalAuth con clientId
  });

  clients[clientId] = client; // Guardar el cliente en memoria

  client.on("ready", () => {
    console.log(`Cliente ${clientId} está listos.`);
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
  client.on("disconnected", async () => {
    console.log(`Cliente ${clientId} desconectado.`);
    let data = qs.stringify({
      funcion: "desconectar_session",
      cliente_id: clientId,
    });
    let config = {
      method: "post",
      maxBodyLength: Infinity,
      url: "http://localhost/apibot/controlador/UsuarioController.php",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      data: data,
    };
    const response = await axios.request(config);
    console.log(response.data);
    delete clients[clientId]; // Eliminar cliente del objeto clients
  });

  client.initialize();
};

// Función para obtener sesiones activas desde PHP
const fetchActiveSessions = async () => {
  try {
    let data = qs.stringify({
      funcion: "buscar_sesiones",
    });
    let config = {
      method: "post",
      maxBodyLength: Infinity,
      url: "http://localhost/apibot/controlador/UsuarioController.php",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      data: data,
    };
    const response = await axios.request(config);

    const sessions = response.data.data;
    console.log(sessions);

    if (sessions.length !== 0) {
      sessions.forEach((session) => {
        console.log(session.clientid);
        initializeClient(session.clientid); // Inicializar cada cliente activo
      });
    } else {
      console.log("no hay sessiones activas");
    }
  } catch (error) {
    console.error("Error obteniendo sesiones activas:", error);
  }
};

// Al iniciar el servidor, buscar sesiones activas en la base de datos
fetchActiveSessions();

io.on("connection", (socket) => {
  console.log("Cliente conectado desde el frontend");
  // Emitimos un evento para informar que el cliente Socket.io está conectado
  socket.emit("connected", "Conectado al backend");
  socket.on("reconnect-client", (clientId) => {
    if (clients[clientId]) {
      console.log(`Reutilizando cliente existente para ${clientId}`);
      socket.emit("ready", { clientId, message: "Cliente ya está listo" });
    } else {
      console.log(
        `No se encontró cliente para ${clientId}, generando nuevo QR.`
      );
      socket.emit("disconnected", { clientId });
    }
  });

  socket.on("request-qr", async (clientId) => {
    if (clients[clientId]) {
      clients[clientId].destroy(); // Cierra el cliente existente
    }
    const client = new Client({
      authStrategy: new LocalAuth({ clientId }), // Usar LocalAuth con clientId
    });

    clients[clientId] = client; // Guardar el cliente en memoria

    client.on("qr", (qr) => {
      console.log(`QR para ${clientId} generado.`);
      qrcode.toDataURL(qr, (err, url) => {
        if (err) {
          console.error("Error generando el código QR", err);
          return;
        }
        socket.emit("qr", { clientId, url }); // Emitimos el QR con el clientId
      });
    });

    client.on("ready", async () => {
      console.log(`Cliente ${clientId} está listos.`);

      let fecha = dayjs().format("YYYY-MM-DD HH:mm:ss");
      // Almacenar la nueva sesión activa en la base de datos a través del servidor PHP
      let data = qs.stringify({
        funcion: "add_session",
        cliente_id: clientId,
        last_connected: fecha,
      });
      let config = {
        method: "post",
        maxBodyLength: Infinity,
        url: "http://localhost/apibot/controlador/UsuarioController.php",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        data: data,
      };
      const response = await axios.request(config);
      console.log(response.data);
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
    client.on("disconnected", async () => {
      console.log(`Cliente ${clientId} desconectado.`);
      let data = qs.stringify({
        funcion: "desconectar_session",
        cliente_id: clientId,
      });
      let config = {
        method: "post",
        maxBodyLength: Infinity,
        url: "http://localhost/apibot/controlador/UsuarioController.php",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        data: data,
      };
      const response = await axios.request(config);
      console.log(response.data);
      delete clients[clientId]; // Eliminar cliente del objeto clients
    });

    client.initialize();
  });
});

// Iniciar el servidor en el puerto 3001
server.listen(3001, () => {
  console.log("Servidor corriendo en http://localhost:3001");
});
