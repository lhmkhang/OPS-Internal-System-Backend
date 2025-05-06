/* const path = require("path");
const logger = require('./logger.js');
const mongodb = require('mongodb');
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(__dirname, "../..", ".env") });

const MongoClient = mongodb.MongoClient;
const loggerInfo = logger.getLogger('infoLogger');
const loggerError = logger.getLogger('errorLogger');
let client;

async function connect() {
    try {
        client = new MongoClient(process.env.DB_CONNECTION_STRING, { useNewUrlParser: true, useUnifiedTopology: true });
        await client.connect();
        loggerInfo.info('Connected successfully to databases');
    } catch (err) {
        loggerError.error('Failed to connect to databases', err);
        setTimeout(connect, 5000);  // Thử kết nối lại sau 5 giây
    }
}

async function getDatabase(dbName) {
    if (!client || !client.topology.isConnected()) {
        await connect();
    }
    return client.db(dbName);
}

connect();  // Kết nối tới DBs ngay khi app start

// Xử lý khi chương trình bị tắt
process.on('exit', (code) => {
    if (client && client.topology.isConnected()) {
        loggerInfo.info('Closing MongoDB connection');
        client.close();
    }
}); */

const path = require("path");
const logger = require("./logger");
const mongoose = require("mongoose");
const dotenv = require("dotenv").config({ path: path.resolve(__dirname, "../..", ".env") });

const loggerInfo = logger.getLogger("infoLogger");
const loggerError = logger.getLogger("errorLogger");

const MAX_RETRIES = 5; // Số lần thử kết nối lại tối đa
let retries = 0;

const connectDB = async () => {
  try {
    const ENVIRONMENT = process.env.NODE_ENV;
    let CONNECTION_STRING;

    if (ENVIRONMENT === 'development') {
      CONNECTION_STRING = process.env.DB_DEV_CONNECTION_STRING;
    } else {
      CONNECTION_STRING = process.env.DB_CONNECTION_STRING;
    }

    await mongoose.connect(CONNECTION_STRING, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    loggerInfo.info("Connected successfully to databases");
  } catch (err) {
    loggerError.error("Failed to connect to databases", err);
    retries += 1;
    if (retries < MAX_RETRIES) {
      setTimeout(connectDB, 5000); // Thử kết nối lại sau 5 giây
    } else {
      loggerError.error("Max retries reached. Exiting...");
      process.exit(1);
    }
  }

  // Xử lý khi chương trình bị tắt
  process.on("exit", (code) => {
    mongoose.connection.close(() => {
      loggerInfo.info("Closing MongoDB connection");
      process.exit(code);
    });
  });
};

module.exports = connectDB;
