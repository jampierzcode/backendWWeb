require("dotenv").config(); // Cargar las variables de entorno desde .env
const express = require("express");
const cors = require("cors");
const http = require("http");
const socketIo = require("socket.io");
const axios = require("axios");
const qs = require("qs");
const path = require("path");
const fs = require("fs");
const qrcode = require("qrcode");
const dayjs = require("dayjs");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const jwt = require("jsonwebtoken"); // Importar jsonwebtoken

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Middleware
app.use(
  cors({
    origin: ["https://erpbot.mcsolucionesti.com", "http://localhost:3000"], // permite solo este origen
  })
);
app.use(express.json());

// Configuración del puerto y la API
const PORT = process.env.PORT || 3001;
const apiUrl = process.env.API_URL;

// Almacenar los clientes de WhatsApp por clientId
const clients = {};

// Función para inicializar un cliente de WhatsApp
const initializeClient = (clientId) => {
  console.log(`${clientId} - cliente de base de datos`);
  const client = new Client({
    authStrategy: new LocalAuth({ clientId }), // Usar LocalAuth con clientId
  });

  clients[clientId] = client; // Guardar el cliente en memoria

  client.initialize();

  client.on("ready", async () => {
    console.log(`Cliente ${clientId} está listo.`);
  });

  client.on("message", async (message) => {
    console.log(message);
    if (message.body.toLowerCase() === "fotos") {
      const imagePath = path.join(__dirname, "imagenes/1.jpg");
      const media = MessageMedia.fromFilePath(imagePath);
      await client.sendMessage(message.from, media, {
        caption: "Aquí tienes la imagen que pediste!",
      });
    }
  });

  client.on("disconnected", async () => {
    console.log(`Cliente ${clientId} desconectado.`);
    await handleClientDisconnection(clientId);
  });

  client.on("auth_failure", (message) => {
    console.error("Autenticación fallida:", message);
  });
};

// Manejar la desconexión del cliente
const handleClientDisconnection = async (clientId) => {
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
  delete clients[clientId]; // Eliminar cliente del objeto clients
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

    if (sessions.length !== 0) {
      sessions.forEach((session) => {
        initializeClient(session.clientid); // Inicializar cada cliente activo
      });
    } else {
      console.log("No hay sesiones activas");
    }
  } catch (error) {
    console.error("Error obteniendo sesiones activas:", error);
  }
};

// Al iniciar el servidor, buscar sesiones activas en la base de datos
fetchActiveSessions();

// Ruta de login
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    // Consulta a la base de datos (ejemplo usando MySQL)
    const user = await queryDatabaseForUser(email, password);

    if (!user) {
      return res.status(401).json({
        status: "error",
        msg: "Credenciales inválidas",
        token: "",
        user: null,
      });
    }

    // Generar token
    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "1h" } // El token expirará en 1 hora
    );

    res.json({
      status: "success",
      msg: "Inicio de sesión exitoso",
      token,
      user: {
        nombres: user.nombres,
        email: user.email,
        celular: user.celular,
      },
    });
  } catch (error) {
    console.error("Error en el login:", error);
    res.status(500).json({
      status: "error",
      msg: "Error interno del servidor",
      token: "",
      user: null,
    });
  }
});

// Función para consultar la base de datos
const queryDatabaseForUser = async (email, password) => {
  try {
    let data = qs.stringify({
      funcion: "login",
      email,
      password,
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
    return response.data.data;
  } catch (error) {
    console.error("Ocurrio un error:", error);
    return null;
  }
};

// Socket.IO
io.on("connection", (socket) => {
  console.log("Cliente conectado desde el frontend");
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
      client.on("authenticated", () => {
        console.log(`Cliente ${clientId} está autenticado.`);
        // Emitimos un evento al frontend indicando que el cliente se está conectando
        socket.emit("connecting", {
          clientId,
          message: "Cliente está autenticado, conectando...",
        });
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
