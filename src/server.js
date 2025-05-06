const express = require("express");
const path = require("path");
const initUserApiRoutes = require("./routers/userApiRouters.js");
const initWebRoutes = require("./routers/webRouters.js");
const initWheelApiRoutes = require("./routers/WheelApiRouters.js");
const initProjectApiRoutes = require("./routers/projectRoutes.js");
const serverConfiguration = require("./configs/server.config.js");
const connectDB = require("./helpers/connectDB.js");
const dotenv = require("dotenv").config({ path: path.resolve(__dirname, "..", "docker.env") });
const logger = require("./helpers/logger.js");
const loggerInfo = logger.getLogger("infoLogger");
const app = express();
const initAuthorizationRoutes = require("./routers/authorization.js");
// const { UserRoleModel } = require("./models/UserRoleModel");
const http = require("http");
const socketIo = require("socket.io");
const initReportingApiRoutes = require("./routers/reportingApiRouters.js");

// Connect to mongoDB
connectDB();

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.ALLOW_CORS_SOCKET, // Thay đổi với địa chỉ của client
    methods: ["GET", "POST"]
  }
});

const activeUsers = {};

io.on('connection', (socket) => {
  loggerInfo.info('User connected');

  socket.on('joinLuckyMoney', (userId) => {
    if (activeUsers[userId] && activeUsers[userId] !== socket.id) {
      // Nếu người dùng đang sử dụng chức năng này, gửi sự kiện 'accessDenied'
      socket.emit('accessDenied');
    } else {
      // Đánh dấu người dùng này với socket.id hiện tại
      activeUsers[userId] = socket.id;
    }
  });

  socket.on('disconnect', () => {
    // Khi người dùng ngắt kết nối, xóa đánh dấu nếu không có kết nối khác
    Object.keys(activeUsers).forEach(userId => {
      if (activeUsers[userId] === socket.id) {
        delete activeUsers[userId];
      }
    });
    loggerInfo.info('User disconnected');
  });
});

/* if (process.env.NODE_ENV === 'production') {
  const next = require('next');
  const dev = process.env.NODE_ENV !== 'production';
  const nextApp = next({ dev: dev, dir: process.env.PATH_FOLDER_FE, port: process.env.PORT });
  const handleNextRequests = nextApp.getRequestHandler();

  nextApp.prepare().then(() => {

    // Configuration of express server
    serverConfiguration(app);

    initWheelApiRoutes(app);
    initUserApiRoutes(app);
    // initAuthorizationRoutes(app);

    const activeUsers = {};

    io.on('connection', (socket) => {
      loggerInfo.info('User connected');

      socket.on('joinLuckyMoney', (userId) => {
        if (activeUsers[userId] && activeUsers[userId] !== socket.id) {
          // Nếu người dùng đang sử dụng chức năng này, gửi sự kiện 'accessDenied'
          socket.emit('accessDenied');
        } else {
          // Đánh dấu người dùng này với socket.id hiện tại
          activeUsers[userId] = socket.id;
        }
      });

      socket.on('disconnect', () => {
        // Khi người dùng ngắt kết nối, xóa đánh dấu nếu không có kết nối khác
        Object.keys(activeUsers).forEach(userId => {
          if (activeUsers[userId] === socket.id) {
            delete activeUsers[userId];
          }
        });
        loggerInfo.info('User disconnected');
      });
    });

    app.use((err, req, res, next) => {
      err.statusCode = err.statusCode || 500;
      err.status = err.status || "error";

      const loggerError = logger.getLogger("errorLogger");
      loggerError.error(
        `${req.ip} - ${req.method} ${req.url} ${err.statusCode} - ${err.name}: ${err.message}\n${err.stack}`
      );

      res.status(err.statusCode).json({
        status: err.status,
        code: err.statusCode,
        message: err.message,
      });
    });

    app.get('/okr-report', (req, res) => {
      res.sendFile(__dirname + '/Report_Web_Html/Report_Web/Report_Web/MaximizeEfficiencyPage.html')
    });

    app.get('/ProjectDesignReport.html', (req, res) => {
      res.sendFile(__dirname + '/Report_Web_Html/Report_Web/Report_Web/ProjectDesignReport.html')
    });

    app.get('/CustomerSatisfactionPage.html', (req, res) => {
      res.sendFile(__dirname + '/Report_Web_Html/Report_Web/Report_Web/CustomerSatisfactionPage.html')
    });

    app.get('/MaximizeEfficiencyPage.html', (req, res) => {
      res.sendFile(__dirname + '/Report_Web_Html/Report_Web/Report_Web/MaximizeEfficiencyPage.html')
    });

    app.get('/IncidentPage.html', (req, res) => {
      res.sendFile(__dirname + '/Report_Web_Html/Report_Web/Report_Web/IncidentPage.html')
    });

    app.get('/ManualTaskPage.html', (req, res) => {
      res.sendFile(__dirname + '/Report_Web_Html/Report_Web/Report_Web/ManualTaskPage.html')
    });

    app.get('/ImprovementIdeasPage.html', (req, res) => {
      res.sendFile(__dirname + '/Report_Web_Html/Report_Web/Report_Web/ImprovementIdeasPage.html')
    });

    app.get('/PersonalDevelopmentPage.html', (req, res) => {
      res.sendFile(__dirname + '/Report_Web_Html/Report_Web/Report_Web/PersonalDevelopmentPage.html')
    });

    app.get('/Calculation.html', (req, res) => {
      res.sendFile(__dirname + '/Report_Web_Html/Report_Web/Report_Web/Calculation.html')
    });

    app.get('*', (req, res) => {
      return handleNextRequests(req, res);
    });

    server.listen(process.env.PORT || 8090, () => {
      loggerInfo.info(`Express server is running on port ${process.env.PORT}`);
    });

  })
}  */

// Configuration of express server
serverConfiguration(app);

initProjectApiRoutes(app);
initWheelApiRoutes(app);
initUserApiRoutes(app);
initWebRoutes(app);
// initAuthorizationRoutes(app);

// Mount API reporting
initReportingApiRoutes(app);

app.use((err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || "error";

  const loggerError = logger.getLogger("errorLogger");
  loggerError.error(
    `${req.ip} - ${req.method} ${req.url} ${err.statusCode} - ${err.name}: ${err.message}\n${err.stack}`
  );

  res.status(err.statusCode).json({
    status: err.status,
    code: err.statusCode,
    message: err.message,
  });
});

/* app.listen(process.env.PORT || 8090, () => {
  loggerInfo.info(`Express server is running on port ${process.env.PORT}`);
}); */

server.listen(process.env.PORT || 8091, () => {
  loggerInfo.info(`Express server is running on port ${process.env.PORT}`);
});

// test rabbitmq
/* app.post("/sendLog", async (req, res, next) => {
  await producer.publishMessage(req.body.logType, req.body.message);
  res.send();
}); */

