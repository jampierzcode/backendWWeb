require("dotenv").config(); // Cargar las variables de entorno desde .env
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
// Puedes acceder a la variable API_URL así:
const apiUrl = process.env.API_URL;
// Obtener el puerto desde las variables de entorno o usar 3001 como valor por defecto
const PORT = process.env.PORT || 3001;
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

app.use(
  cors({
    origin: "https://erpbot.mcsolucionesti.com", // permite sólo este origen
  })
);
app.use(express.json());

const clients = {}; // Almacenar los clientes de WhatsApp por clientId

// Función para inicializar un cliente de WhatsApp
const initializeClient = (clientId) => {
  console.log(`${clientId} -cliente de base de datos`);
  const client = new Client({
    authStrategy: new LocalAuth({ clientId }), // Usar LocalAuth con clientId
  });

  clients[clientId] = client; // Guardar el cliente en memoria

  client.initialize();
  client.on("ready", async () => {
    console.log(`Cliente ${clientId} está listos.`);
  });
  // Asegúrate de que la función donde usas 'await' sea async
  client.on("message", async (message) => {
    console.log(message);
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
      url: apiUrl,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      data: data,
    };
    const response = await axios.request(config);
    console.log(response.data);
    clients[clientId].destroy();
    delete clients[clientId]; // Eliminar cliente del objeto clients
  });
  client.on("auth_failure", (message) => {
    console.error("Autenticación fallida:", message);
    // Realiza las acciones necesarias, como reiniciar el proceso de autenticación o destruir la sesión.
    // Si deseas destruir el cliente después de la autenticación fallida
  });

  // client.initialize();
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
      url: apiUrl,
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
    console.log("request-qr");
    if (clients[clientId]) {
      console.log("ya hay un cliente inicializado");
    } else {
      const client = new Client({
        authStrategy: new LocalAuth({ clientId }), // Usar LocalAuth con clientId
      });

      client.on("qr", (qr) => {
        if (clients[clientId]) {
          console.log("existe aun ...");
        } else {
          console.log(`QR para ${clientId} generado.`);
          qrcode.toDataURL(qr, (err, url) => {
            if (err) {
              console.error("Error generando el código QR", err);
              return;
            }
            socket.emit("qr", { clientId, url }); // Emitimos el QR con el clientId
          });
        }
      });

      client.on("ready", async () => {
        if (clients[clientId]) {
          console.log("ya existe y no se puede inicializar de nuevo");
        } else {
          console.log(`Cliente ${clientId} está listos.`);

          clients[clientId] = client; // Guardar el cliente en memoria
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
            url: apiUrl,
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
            },
            data: data,
          };
          socket.emit("ready", { clientId, message: "Cliente ya está listo" });
          const response = await axios.request(config);
          console.log(response.data);
        }
      });
      // Asegúrate de que la función donde usas 'await' sea async
      client.on("message", async (message) => {
        console.log(message);

        // Crear una expresión regular para varias palabras relacionadas con fotos
        const fotosKeywords =
          /(fotos|foto|fotografias|fotitos|fotito|imagenes de referencia|imagenes|images|pics)/i;

        // Comprobar si el mensaje contiene alguna de las palabras clave
        if (fotosKeywords.test(message.body)) {
          const imagesDir = path.join(__dirname, "imagenes");

          fs.readdir(imagesDir, (err, files) => {
            if (err) {
              console.error("Error leyendo la carpeta de imágenes", err);
              return;
            }

            // Enviar cada archivo de imagen en la carpeta
            files.forEach((file) => {
              const filePath = path.join(imagesDir, file);
              const media = MessageMedia.fromFilePath(filePath);
              client.sendMessage(message.from, media);
            });
          });
        }
      });

      client.on("disconnected", async (reason) => {
        await client.destroy();
        if (reason == "NAVIGATION" || reason == "LOGOUT") {
          const folderPath = path.join(
            __dirname,
            `../../../.wwebjs_auth/session-${clientId}`
          );
          fs.rm(folderPath, { recursive: true, force: true }, (err) => {
            if (err) {
              console.log(`Error deleting folder: ${err.message}`);
            } else {
              console.log("Folder deleted successfully");
            }
          });
          let data = qs.stringify({
            funcion: "desconectar_session",
            cliente_id: clientId,
          });
          let config = {
            method: "post",
            maxBodyLength: Infinity,
            url: apiUrl,
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
            },
            data: data,
          };
          const response = await axios.request(config);
          // await client.logout();
          delete clients[clientId];
          console.log(response.data);

          socket.emit("disconnected", { clientId });
        }
      });

      client.initialize();
    }
  });
  // Nueva función para desconectar al cliente desde el frontend
  socket.on("disconnect-client", async (clientId) => {
    if (clients[clientId]) {
      console.log(`Desconectando cliente ${clientId}`);

      clients[clientId].logout(); // Destruir el cliente de WhatsApp
      delete clients[clientId]; // Eliminar el cliente del objeto clients

      // Llamar a la API de PHP para eliminar la sesión de la base de datos
      let data = qs.stringify({
        funcion: "desconectar_session",
        cliente_id: clientId,
      });

      let config = {
        method: "post",
        maxBodyLength: Infinity,
        url: apiUrl,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        data: data,
      };

      const response = await axios.request(config);
      console.log(`Respuesta de la API al desconectar: ${response.data}`);

      socket.emit("disconnected", { clientId }); // Emitir evento de desconexión
    } else {
      console.log(`No se encontró cliente con ID ${clientId}`);
    }
  });
});

// Iniciar el servidor en el puerto 3001
server.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
