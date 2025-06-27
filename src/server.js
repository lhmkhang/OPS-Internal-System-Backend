const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });
const express = require("express");
// Legacy routes (will be refactored gradually)
const initWebRouters = require("./routers/webRouters.js");
const initReportingRoutes = require("./routers/reporting");
const initAppApiRoutes = require("./routers/appApiRouters.js");

// New modular routes
const initAuthApiRoutes = require("./routers/auth/authRoutes.js");
const initUserManagementApiRoutes = require("./routers/operation-planning/userManagementRoutes.js");
const initProjectManagementApiRoutes = require("./routers/operation-planning/projectManagementRoutes.js");
const initInputPlanApiRoutes = require("./routers/operation-planning/inputPlanRoutes.js");

const serverConfiguration = require("./configs/server.config.js");
const connectDB = require("./helpers/connectDB.js");
const logger = require("./helpers/logger.js");
const loggerInfo = logger.getLogger("infoLogger");
const loggerError = logger.getLogger("errorLogger");
const app = express();
const http = require("http");
const socketIo = require("socket.io");
const { initQCCronJob } = require("./cron/qcProcessJob.js");
const { initCollectFieldDefinitionJob } = require("./cron/collectFieldDefinitionJob.js");

// Hàm khởi động server
async function startServer() {
  try {
    // Connect to MongoDB (both connections)
    await connectDB();
    loggerInfo.info("All database connections established successfully");

    const server = http.createServer(app);
    const io = socketIo(server, {
      cors: {
        origin: process.env.ALLOW_CORS_SOCKET,
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

    // Configuration of express server
    serverConfiguration(app);

    // New modular routes
    initAuthApiRoutes(app);
    initUserManagementApiRoutes(app);
    initProjectManagementApiRoutes(app);
    initInputPlanApiRoutes(app);

    // Legacy routes (will be refactored gradually)
    // initProjectApiRoutes(app);
    // initUserApiRouters(app);
    initWebRouters(app);
    initReportingRoutes(app);
    initAppApiRoutes(app);
    // initAuthorizationRoutes(app);

    app.use((err, req, res, next) => {
      err.statusCode = err.statusCode || 500;
      err.status = err.status || "error";

      loggerError.error(
        `${req.ip} - ${req.method} ${req.url} ${err.statusCode} - ${err.name}: ${err.message}\n${err.stack}`
      );

      res.status(err.statusCode).json({
        status: err.status,
        code: err.statusCode,
        message: err.message,
      });
    });

    // Khởi tạo cron job cho QC data
    // initQCCronJob();
    // loggerInfo.info("QC cron job đã được khởi tạo");

    // Khởi tạo cron job cho Field Definition Collection
    // initCollectFieldDefinitionJob();
    loggerInfo.info("Field Definition Collection cron job đã được khởi tạo");

    server.listen(process.env.PORT || 8091, () => {
      loggerInfo.info(`Express server is running on port ${process.env.PORT || 8091}`);
    });
  } catch (error) {
    loggerError.error("Failed to start server:", error);
    process.exit(1);
  }
}

// Khởi động server
startServer();
