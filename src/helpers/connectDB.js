const path = require("path");
const logger = require("./logger");
const mongoose = require("mongoose");
require("dotenv").config({ path: path.resolve(__dirname, "../..", ".env") });

const loggerInfo = logger.getLogger("infoLogger");
const loggerError = logger.getLogger("errorLogger");

const MAX_RETRIES = 5; // Số lần thử kết nối lại tối đa
const RETRY_DELAY = 5000; // Delay giữa các lần thử kết nối (5 giây)

// Lưu trữ các kết nối để tái sử dụng
const connections = {
  primary: null, // Connection đến database chính
  default: null   // Connection đến database mặc định (cũ)
};

/**
 * Kết nối đến database với connectionString
 * @param {string} connectionString - Chuỗi kết nối MongoDB (đã bao gồm tên database)
 * @param {string} connectionName - Tên kết nối (primary/default)
 * @param {number} retries - Số lần thử lại hiện tại
 * @returns {Promise<mongoose.Connection>} - Connection instance
 */
const connectToDatabase = async (connectionString, connectionName, retries = 0) => {
  try {
    if (!connectionString) {
      throw new Error(`Connection string for ${connectionName} is not defined`);
    }

    // Tạo kết nối mới
    const connection = await mongoose.createConnection(connectionString, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    }).asPromise();

    loggerInfo.info(`Connected successfully to ${connectionName} database`);
    return connection;
  } catch (err) {
    loggerError.error(`Failed to connect to ${connectionName} database`, err);

    if (retries < MAX_RETRIES) {
      loggerInfo.info(`Retrying connection to ${connectionName} database in ${RETRY_DELAY / 1000}s... (${retries + 1}/${MAX_RETRIES})`);
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve(connectToDatabase(connectionString, connectionName, retries + 1));
        }, RETRY_DELAY);
      });
    } else {
      loggerError.error(`Max retries reached for ${connectionName} connection. Giving up...`);
      throw err;
    }
  }
};

/**
 * Khởi tạo các kết nối đến các database
 */
const connectDB = async () => {
  try {
    const ENVIRONMENT = process.env.NODE_ENV;
    // Xác định connection strings dựa trên môi trường
    const DEFAULT_CONNECTION_STRING = ENVIRONMENT === 'development'
      ? process.env.DB_DEV_CONNECTION_STRING
      : process.env.DB_CONNECTION_STRING;

    const PRIMARY_CONNECTION_STRING = ENVIRONMENT === 'development'
      ? process.env.DB_DEV_CONNECTION_STRING_PRIMARY
      : process.env.DB_CONNECTION_STRING_PRIMARY;

    // Kết nối đến database default bằng mongoose.connect() để đảm bảo tất cả models 
    // sử dụng mongoose.model() mặc định hoạt động đúng
    await mongoose.connect(DEFAULT_CONNECTION_STRING, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    connections.default = mongoose.connection;
    loggerInfo.info('Connected successfully to default database (mongoose.connect)');

    // Kết nối đến database primary nếu được cung cấp
    if (PRIMARY_CONNECTION_STRING) {
      connections.primary = await connectToDatabase(PRIMARY_CONNECTION_STRING, 'primary');
    } else {
      loggerInfo.warn('No PRIMARY_CONNECTION_STRING provided, skipping primary database connection');
    }

    // Xử lý khi chương trình bị tắt
    process.on("exit", async (code) => {
      await closeAllConnections();
      process.exit(code);
    });

    return connections;
  } catch (err) {
    loggerError.error("Failed to initialize database connections", err);
    throw err; // Để server.js có thể xử lý lỗi
  }
};

/**
 * Lấy kết nối đến database cụ thể
 * @param {string} connectionName - Tên kết nối (primary/default)
 * @returns {mongoose.Connection} - Connection instance
 */
const getConnection = (connectionName = 'default') => {
  if (connectionName === 'default') {
    return mongoose.connection; // Trả về kết nối mặc định của mongoose
  }

  const connection = connections[connectionName];
  if (!connection) {
    loggerError.error(`Connection '${connectionName}' not found or not initialized`);
    throw new Error(`Connection '${connectionName}' not found or not initialized`);
  }
  return connection;
};

/**
 * Đóng tất cả các kết nối
 */
const closeAllConnections = async () => {
  try {
    const closePromises = [];

    // Đóng kết nối default (mongoose.connection)
    if (mongoose.connection.readyState !== 0) {
      loggerInfo.info('Closing default MongoDB connection');
      closePromises.push(mongoose.connection.close());
    }

    // Đóng kết nối primary nếu có
    if (connections.primary) {
      loggerInfo.info('Closing primary MongoDB connection');
      closePromises.push(connections.primary.close());
    }

    await Promise.all(closePromises);
    loggerInfo.info("All MongoDB connections closed successfully");
  } catch (err) {
    loggerError.error("Error closing MongoDB connections", err);
  }
};

module.exports = connectDB;
module.exports.getConnection = getConnection;
module.exports.connections = connections;
