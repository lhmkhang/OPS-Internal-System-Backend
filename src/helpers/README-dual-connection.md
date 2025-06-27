# Tài liệu về kết nối kép với MongoDB

## Tổng quan

Hệ thống hỗ trợ kết nối đồng thời đến 2 cơ sở dữ liệu MongoDB khác nhau:
- **Kết nối default** (mặc định): Tương thích ngược với code cũ, sử dụng `mongoose.model` trực tiếp.
- **Kết nối primary**: Kết nối mới, cần sử dụng thông qua `getConnection('primary')`.

## Cấu hình biến môi trường

File `.env` cần có các biến môi trường sau:

```env
# Kết nối default (tương thích với code cũ)
DB_CONNECTION_STRING=mongodb://username:password@host:port/database
DB_DEV_CONNECTION_STRING=mongodb://username:password@host:port/dev-database

# Kết nối primary (mới)
DB_CONNECTION_STRING_PRIMARY=mongodb://username:password@host:port/primary-database
DB_DEV_CONNECTION_STRING_PRIMARY=mongodb://username:password@host:port/primary-dev-database

# Môi trường (development/production)
NODE_ENV=development
```

## Cách sử dụng

### 1. Sử dụng kết nối default (tương thích với code cũ)

```javascript
// Sử dụng như bình thường, không cần thay đổi code hiện tại
const UserModel = require('../models/userModel');
const users = await UserModel.find();
```

### 2. Sử dụng kết nối primary (mới)

```javascript
// Import module connectDB
const connectDB = require('../helpers/connectDB');

// Lấy kết nối primary
const primaryConn = connectDB.getConnection('primary');

// Tạo model trên kết nối này
const mongoose = require('mongoose');
const userSchema = new mongoose.Schema({ /* ... */ });
const UserModel = primaryConn.model('User', userSchema);

// Sử dụng model
const users = await UserModel.find();
```

### 3. Tạo helper để dễ dàng sử dụng cả hai kết nối

```javascript
function createModelOnConnection(modelName, schema, connectionName = 'default') {
  const connectDB = require('../helpers/connectDB');
  const conn = connectDB.getConnection(connectionName);
  return conn.model(modelName, schema);
}

// Sử dụng
const userSchema = new mongoose.Schema({ /* ... */ });
const UserOnDefault = createModelOnConnection('User', userSchema, 'default');
const UserOnPrimary = createModelOnConnection('User', userSchema, 'primary');
```

## Xử lý lỗi kết nối

- Hệ thống tự động thực hiện tới MAX_RETRIES lần kết nối lại khi gặp lỗi.
- Lỗi kết nối được ghi lại trong file log.
- Nếu kết nối `primary` không được cấu hình (không có biến môi trường), hệ thống vẫn hoạt động bình thường với kết nối `default`.

## Lưu ý

1. **Tính tương thích ngược**: Toàn bộ code cũ vẫn hoạt động như bình thường, không cần thay đổi.
2. **Đóng kết nối**: Hệ thống tự động đóng tất cả kết nối khi ứng dụng kết thúc.
3. **Mô hình dữ liệu**: Lưu ý rằng cùng một schema có thể được sử dụng cho cả hai kết nối, nhưng chúng hoạt động trên các cơ sở dữ liệu khác nhau.
4. **Test kết nối**: Sử dụng `node src/utils/testConnection.js` để kiểm tra cả hai kết nối.
5. **Ví dụ sử dụng**: Xem `src/utils/exampleUsage.js` để biết thêm chi tiết về cách sử dụng.