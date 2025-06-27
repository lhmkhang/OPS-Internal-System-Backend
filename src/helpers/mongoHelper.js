import { MongoClient, ObjectId } from 'mongodb';
import EXCEL from 'exceljs';
import { Readable } from 'stream';
import fs from 'fs/promises';

const clients = new Map();

/**
 * Kết nối đến MongoDB
 * @param {string} uri - Đường dẫn kết nối MongoDB (MongoDB connection string)
 * @param {string} dbName - Tên của database
 * @returns {Promise<Object>} - Database instance
 */
export async function connectToDatabase(uri, dbName) {
    try {
        // Nếu đã có kết nối với URI này, trả về kết nối đó
        if (clients.has(uri)) {
            console.log(`⚠️ Kết nối đến MongoDB đã tồn tại: ${uri}`);
            return clients.get(uri).db(dbName);
        }

        // Tạo một instance của MongoClient
        const client = new MongoClient(uri, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            readPreference: 'secondaryPreferred'
        });

        // Kết nối đến MongoDB
        await client.connect();
        console.log('✅ Kết nối đến MongoDB thành công');

        // Lưu trữ client vào Map
        clients.set(uri, client);

        // Trả về database instance
        return client.db(dbName);
    } catch (error) {
        console.error('❌ Lỗi khi kết nối đến MongoDB:', error);
        throw error;
    }
}

/**
 * Đóng tất cả kết nối MongoDB
 */
export async function closeDatabaseConnections() {
    try {
        for (const [uri, client] of clients.entries()) {
            await client.close();
            console.log(`✅ Đóng kết nối MongoDB thành công`);
        }

        // Xóa tất cả các kết nối đã đóng
        clients.clear();
    } catch (error) {
        console.error('❌ Lỗi khi đóng kết nối MongoDB:', error);
        throw error;
    }
}

export async function ensureCollectionExists(database, collectionName, options = {}) {
    try {
        // Kiểm tra collection đã tồn tại hay chưa
        const collections = await database.listCollections({}, { nameOnly: true }).toArray();
        const collectionExists = collections.some(coll => coll.name === collectionName);

        if (!collectionExists) {
            // Tạo collection nếu chưa tồn tại
            await database.createCollection(collectionName, options);
            console.log(`✅ Collection ${collectionName} has been created.`);
        }
    } catch (error) {
        console.log(`❌ ${error}`);
    }
}

export async function exportDataFromDatabaseToExcel(database, project_id, filePath, reportList) {
    const checkpointCollection = `${project_id}_check_point`;
    const checkpoint = await database.collection(checkpointCollection).findOne({});
    let newCheckpoint = {};
    let previousCheckpoint = checkpoint
        ? { ...checkpoint, created_time: new Date() }
        : null;

    let fileIndex = 1;
    const maxRowsPerSheet = 300000;
    let remainingRows = {};
    let totalSheetsWritten = 0;

    try {
        let workbook = null;
        let commitPromises = [];

        for (const reportName of reportList) {
            const collectionName = `${project_id}_${reportName}`;
            const sheetName = reportName.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
            const checkpointField = `${reportName}_last_id`;
            const lastId = checkpoint?.[checkpointField] || null;

            const query = lastId ? { _id: { $gt: new ObjectId(lastId) } } : {};
            const cursor = database.collection(collectionName)
                .find(query)
                .sort({ _id: 1 })
                .batchSize(1000);

            let hasData = false;
            let sheet = null;
            let latestId = null;
            let rowCountSheet = 0;

            for (let doc = await cursor.next(); doc; doc = await cursor.next()) {
                if (!workbook) {
                    workbook = new EXCEL.stream.xlsx.WorkbookWriter({
                        filename: `${filePath}_part${fileIndex}.xlsx`
                    });
                }
                if (!sheet) {
                    sheet = workbook.addWorksheet(sheetName);
                    sheet.columns = Object.keys(doc)
                        .filter(key => key !== '_id' && key !== 'created_time')
                        .map(key => ({ header: key, key }));
                }

                hasData = true;
                if (rowCountSheet < maxRowsPerSheet) {
                    const { _id, created_time, ...rest } = doc;
                    sheet.addRow(rest).commit();
                    rowCountSheet++;
                } else {
                    if (!remainingRows[reportName]) remainingRows[reportName] = [];
                    remainingRows[reportName].push(doc);
                }
                latestId = doc._id.toString();
            }

            if (hasData && sheet) {
                commitPromises.push(sheet.commit());
                newCheckpoint[checkpointField] = latestId;
                totalSheetsWritten++;
            }
        }

        if (totalSheetsWritten > 0 && workbook) {
            console.log(`⏳ Waiting for all sheets to commit before committing workbook...`);
            await Promise.all(commitPromises);

            const part1Path = `${filePath}_part${fileIndex}.xlsx`;
            console.log(`💾 Committing file: ${part1Path}`);
            await workbook.commit();
            console.log(`✅ Saved file: ${part1Path}`);
        } else {
            console.log(`⚠️ No data to write, skipping file creation.`);
            if (workbook) {
                workbook = null;
                try {
                    await fs.unlink(`${filePath}_part${fileIndex}.xlsx`);
                } catch (err) {
                    if (err.code !== 'ENOENT') console.error(`❌ Failed to delete empty file: ${err.message}`);
                }
            }
        }

        while (Object.keys(remainingRows).length > 0) {
            fileIndex++;
            const nextFilePath = `${filePath}_part${fileIndex}.xlsx`;

            console.log(`🛠 Creating new file: ${nextFilePath}`);

            workbook = new EXCEL.stream.xlsx.WorkbookWriter({
                filename: nextFilePath
            });
            commitPromises = [];
            let fileHasData = false;

            for (const reportName in remainingRows) {
                const sheetName = reportName.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
                let sheet = workbook.addWorksheet(sheetName);
                let latestId = null;
                let rowCountSheet = 0;
                const rowsToWrite = remainingRows[reportName];

                sheet.columns = Object.keys(rowsToWrite[0])
                    .filter(key => key !== '_id' && key !== 'created_time')
                    .map(key => ({ header: key, key }));

                for (const doc of rowsToWrite) {
                    if (rowCountSheet < maxRowsPerSheet) {
                        const { _id, created_time, ...rest } = doc;
                        sheet.addRow(rest).commit();
                        rowCountSheet++;
                        latestId = _id.toString();
                        fileHasData = true;
                    } else {
                        break;
                    }
                }

                commitPromises.push(sheet.commit());
                newCheckpoint[`${reportName}_last_id`] = latestId;

                if (rowCountSheet === maxRowsPerSheet) {
                    remainingRows[reportName] = rowsToWrite.slice(maxRowsPerSheet);
                } else {
                    delete remainingRows[reportName];
                }
            }

            if (fileHasData) {
                console.log(`⏳ Waiting for all sheets to commit before committing workbook...`);
                await Promise.all(commitPromises);

                console.log(`💾 Committing file: ${nextFilePath}`);
                await workbook.commit();
                console.log(`✅ Saved file: ${nextFilePath}`);
            } else {
                console.log(`⚠️ No data in remaining rows, skipping file creation.`);
                workbook = null;
                try {
                    await fs.unlink(nextFilePath);
                } catch (err) {
                    if (err.code !== 'ENOENT') console.error(`❌ Failed to delete empty file: ${err.message}`);
                }
                break;
            }
        }

        if (totalSheetsWritten > 0) {
            await ensureCollectionExists(database, checkpointCollection);
            const updateCheckpoint = { $set: newCheckpoint };

            if (previousCheckpoint) {
                updateCheckpoint.$push = {
                    previous_checkpoints: {
                        $each: [{
                            quality_report_last_id: previousCheckpoint.quality_report_last_id,
                            quantity_report_last_id: previousCheckpoint.quantity_report_last_id,
                            created_time: previousCheckpoint.created_time
                        }],
                        $slice: -5
                    }
                };
            }

            await database.collection(checkpointCollection).updateOne({}, updateCheckpoint, { upsert: true });
            console.log('✅ Checkpoint updated successfully.');
        } else {
            console.log('⚠️ No new data found, checkpoint not updated.');
        }
    } catch (error) {
        console.error('❌ Error during export:', error);
        throw error;
    }
}