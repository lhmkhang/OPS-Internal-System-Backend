const LODASH = require('lodash');
const mongoose = require('mongoose');

/**
 * Hàm so sánh và trả về dữ liệu sai lệch giữa các bước
 * @param {Array} fieldNotCount - Danh sách trường không tính
 * @param {Object} document - Document từ MongoDB
 * @param {Array} dataFiltered - Dữ liệu đã lọc
 * @param {String} projectId - ID dự án
 * @param {String} batchId - ID batch
 * @returns {Array} - Danh sách mistake report theo cấu trúc mới
 */
function getMistake(fieldNotCount, document, dataFiltered, projectId, batchId) {
    const result = [];
    const currentDate = new Date();

    // Lặp qua từng record trong dataFiltered
    dataFiltered.forEach((record, record_idx) => {
        const keyedData = record.keyed_data;
        if (!keyedData || keyedData.length === 0) return;

        // Nhóm theo task_def_key, sau đó tách theo task_id nếu có nhiều hơn 2 bản ghi
        const groupedData = LODASH.groupBy(keyedData, 'task_def_key');
        let human_task = {};
        for (let key in groupedData) {
            const total_section = LODASH.uniq(LODASH.map(groupedData[key], 'section'));
            if (groupedData[key].length > total_section.length) {
                let taskGroupedData = LODASH.groupBy(groupedData[key], 'task_id');
                Object.keys(taskGroupedData).forEach((taskId, index) => {
                    if (index === 0) {
                        human_task[key] = taskGroupedData[taskId];
                    } else {
                        let reworkKey = `rework_${index}_${key}`;
                        if (!human_task[reworkKey]) {
                            human_task[reworkKey] = [];
                        }
                        human_task[reworkKey] = human_task[reworkKey].concat(taskGroupedData[taskId]);
                    }
                });
            } else {
                human_task[key] = groupedData[key];
            }
        }

        // Lấy danh sách các bước (giả sử thứ tự theo thời gian nhập dữ liệu đã được bảo toàn)
        const stepKeys = Object.keys(human_task);
        // Duyệt theo từng bước của human_task (ngoại trừ bước cuối cùng)
        stepKeys.forEach((currentStepKey, stepIndex) => {
            // Nếu là bước cuối cùng thì không so sánh vì không có bước sau nào để làm final
            if (stepIndex === stepKeys.length - 1) return;

            const stepEntries = human_task[currentStepKey];
            stepEntries.forEach((entry) => {
                const section = entry.section;

                // Tìm kiếm "final entry" có chứa section đó trong các bước sau (từ cuối về sau bước hiện tại)
                let finalEntry = null;
                let finalStepUsedKey = null;
                for (let k = stepKeys.length - 1; k > stepIndex; k--) {
                    const candidate = human_task[stepKeys[k]].find(e => e.section === section);
                    if (candidate) {
                        finalEntry = candidate;
                        finalStepUsedKey = stepKeys[k];
                        break;
                    }
                }
                // Nếu không tìm thấy final entry nào chứa section thì bỏ qua so sánh entry này
                if (!finalEntry) return;

                // Lấy dữ liệu của bước hiện tại và final entry để so sánh
                const stepData = entry.data;
                const finalData = finalEntry.data;
                const stepDataLength = stepData.length;
                const finalDataLength = finalData.length;

                // Loại trừ các field nằm trong fieldNotCount hoặc pattern
                const isFieldExcluded = (field) =>
                    fieldNotCount.includes(field.toLowerCase())

                // 1. So sánh từng dòng của dữ liệu (row) có ở cả hai bước
                LODASH.forEach(stepData, (item, i) => {
                    const finalItemData = finalData[i] || {};
                    LODASH.forEach(item, (value, field) => {
                        if (!isFieldExcluded(field)) {
                            const finalValue = finalItemData[field]?.text || "";
                            const stepValue = value.text || "";
                            if (finalValue !== stepValue) {
                                // Map sang cấu trúc schema mới
                                result.push({
                                    project_id: new mongoose.Types.ObjectId(projectId),
                                    batch_id: new mongoose.Types.ObjectId(batchId),
                                    batch_name: document.batch_name,
                                    doc_id: new mongoose.Types.ObjectId(document._id.toString()),
                                    doc_uri: document.doc_uri.join("|"),
                                    s2_url: document.s2_url.join("|"),
                                    line_idx: i + 1,
                                    record_idx: record_idx + 1,
                                    field_name: field,
                                    layout_name: document.layout_name,
                                    user_name_keyer: entry.keyer,
                                    user_name_final: finalEntry.keyer,
                                    task_keyer_name: currentStepKey,
                                    task_final_name: finalStepUsedKey,
                                    section_keyer: section,
                                    section_final: section,
                                    value_keyer: stepValue,
                                    value_final: finalValue,
                                    captured_keyer_at: entry.createdtime,
                                    captured_final_at: finalEntry.createdtime,
                                    compared_at: currentDate,
                                    imported_date: document.created_date || currentDate,
                                    exported_date: document.exported_date,
                                    uploaded_date: document.delivery_date
                                });
                            }
                        }
                    });
                });

                // 2. Xử lý các dòng dư thừa trong finalData (nếu finalData có nhiều dòng hơn stepData)
                for (let i = stepDataLength; i < finalDataLength; i++) {
                    const finalItemData = finalData[i] || {};
                    LODASH.forEach(finalItemData, (value, field) => {
                        if (!isFieldExcluded(field)) {
                            result.push({
                                project_id: new mongoose.Types.ObjectId(projectId),
                                batch_id: new mongoose.Types.ObjectId(batchId),
                                batch_name: document.batch_name,
                                doc_id: new mongoose.Types.ObjectId(document._id.toString()),
                                doc_uri: document.doc_uri.join("|"),
                                s2_url: document.s2_url.join("|"),
                                line_idx: i + 1,
                                record_idx: record_idx + 1,
                                field_name: field,
                                layout_name: document.layout_name,
                                user_name_keyer: entry.keyer,
                                user_name_final: finalEntry.keyer,
                                task_keyer_name: currentStepKey,
                                task_final_name: finalStepUsedKey,
                                section_keyer: section,
                                section_final: section,
                                value_keyer: '',
                                value_final: value.text || "",
                                captured_keyer_at: entry.createdtime,
                                captured_final_at: finalEntry.createdtime,
                                compared_at: currentDate,
                                imported_date: document.created_date || currentDate,
                                exported_date: document.exported_date,
                                uploaded_date: document.delivery_date
                            });
                        }
                    });
                }

                // 3. Xử lý các dòng dư thừa trong stepData (nếu stepData có nhiều dòng hơn finalData)
                for (let i = finalDataLength; i < stepDataLength; i++) {
                    const stepItemData = stepData[i] || {};
                    LODASH.forEach(stepItemData, (value, field) => {
                        if (!isFieldExcluded(field)) {
                            result.push({
                                project_id: new mongoose.Types.ObjectId(projectId),
                                batch_id: new mongoose.Types.ObjectId(batchId),
                                batch_name: document.batch_name,
                                doc_id: new mongoose.Types.ObjectId(document._id.toString()),
                                doc_uri: document.doc_uri.join("|"),
                                s2_url: document.s2_url.join("|"),
                                line_idx: i + 1,
                                record_idx: record_idx + 1,
                                field_name: field,
                                layout_name: document.layout_name,
                                user_name_keyer: entry.keyer,
                                user_name_final: finalEntry.keyer,
                                task_keyer_name: currentStepKey,
                                task_final_name: finalStepUsedKey,
                                section_keyer: section,
                                section_final: section,
                                value_keyer: value.text || '',
                                value_final: '',
                                captured_keyer_at: entry.createdtime,
                                captured_final_at: finalEntry.createdtime,
                                compared_at: currentDate,
                                imported_date: document.created_date || currentDate,
                                exported_date: document.exported_date,
                                uploaded_date: document.delivery_date
                            });
                        }
                    });
                }
            });
        });
    });
    return result;
}

/**
 * Hàm tính số lượng field, ký tự được thực hiện trong quá trình QC
 * @param {String} filterControl - Kiểu lọc (field/character)
 * @param {Array} fieldNotCount - Danh sách field không tính
 * @param {Object} document - Document từ MongoDB
 * @param {Array} dataFiltered - Dữ liệu đã lọc
 * @param {String} projectId - ID dự án
 * @param {String} batchId - ID batch
 * @param {RegExp} qcPattern - Pattern để kiểm tra QC task từ DB
 * @returns {Array} - Danh sách QC effort theo cấu trúc mới
 */
function getQCAmount(filterControl, fieldNotCount, document, dataFiltered, projectId, batchId, qcPattern = /qc|_qc_|_aqc_|_qca_|_qc|qc_|quality_check|approve_mistake|_confirm|confirm_/i) {
    const finalData = [];
    const currentDate = new Date();

    dataFiltered.forEach((record, idx) => {
        const keyedData = record.keyed_data;
        if (!keyedData || !Array.isArray(keyedData)) {
            return;
        }

        const groupedData = LODASH.groupBy(keyedData, 'task_def_key');
        let human_task = {};

        for (let key in groupedData) {
            const total_section = LODASH.uniq(LODASH.map(groupedData[key], 'section'));
            if (groupedData[key].length > total_section.length) {
                let taskGroupedData = LODASH.groupBy(groupedData[key], 'task_id');
                Object.keys(taskGroupedData).forEach((taskId, index) => {
                    if (index === 0) {
                        human_task[key] = taskGroupedData[taskId];
                    } else {
                        let reworkKey = `rework_${index}_${key}`;
                        if (!human_task[reworkKey]) {
                            human_task[reworkKey] = [];
                        }
                        human_task[reworkKey] = human_task[reworkKey].concat(taskGroupedData[taskId]);
                    }
                });
            } else {
                human_task[key] = groupedData[key];
            }
        }

        // Xác định task nào là QC bằng cách kiểm tra key cuối cùng trong human_task
        const taskKeys = Object.keys(human_task);
        let isQC = false;
        const QC_PATTERN = qcPattern;

        if (taskKeys.length > 0) {
            // Lấy key cuối cùng trong human_task
            const lastKey = taskKeys[taskKeys.length - 1];
            // Chỉ đánh dấu là QC nếu key cuối cùng có chứa pattern QC
            isQC = QC_PATTERN.test(lastKey.toLowerCase());
        }

        const workType = filterControl && filterControl.toLowerCase();
        for (let task of Object.keys(human_task)) {
            let total_field = 0;
            let total_character = 0;

            for (const obj of human_task[task]) {
                // Kiểm tra xem obj có data hay không và data có phần tử đầu tiên không
                if (!obj.data || !obj.data[0]) continue;

                if (workType === 'field' || workType === 'both') {
                    if (fieldNotCount && fieldNotCount.length > 0) {
                        total_field += Object.keys(obj.data[0]).filter(e => !fieldNotCount.includes(e)).length;
                    } else {
                        total_field += Object.keys(obj.data[0]).length;
                    }
                }

                if (workType === 'character' || workType === 'both') {
                    if (fieldNotCount && fieldNotCount.length > 0) {
                        total_character += Object.keys(obj.data[0])
                            .filter(e => !fieldNotCount.includes(e))
                            .reduce((sum, field) => sum + (obj.data[0][field]?.text?.length || 0), 0);
                    } else {
                        total_character += Object.keys(obj.data[0])
                            .reduce((sum, field) => sum + (obj.data[0][field]?.text?.length || 0), 0);
                    }
                }
            }

            const lastItem = LODASH.last(human_task[task]);
            if (!lastItem) continue;

            // Kiểm tra xem task hiện tại có chứa pattern QC hay không
            const isQCTask = QC_PATTERN.test(task);

            // Mapping sang cấu trúc mới của QCEffort model
            finalData.push({
                project_id: new mongoose.Types.ObjectId(projectId),
                batch_id: new mongoose.Types.ObjectId(batchId),
                batch_name: document.batch_name,
                doc_id: new mongoose.Types.ObjectId(document._id.toString()),
                record_idx: idx + 1,
                line_idx: 0, // Không có trong cấu trúc cũ, mặc định là 0
                user_name_keyer: lastItem.keyer,
                task_keyer_name: task,
                section_keyer: lastItem.section,
                layout_name: document.layout_name,
                work_type: workType === 'field' ? 'Field' : (workType === 'character' ? 'Character' : 'Both'),
                total_field: workType === 'character' ? 0 : total_field,
                total_character: workType === 'field' ? 0 : total_character,
                is_qc: isQC && !isQCTask, // Chỉ những task không phải QC mới được đánh dấu là QC nếu document có task QC ở cuối
                captured_keyer_at: lastItem.createdtime,
                compared_at: currentDate,
                imported_date: document.created_date || currentDate,
                exported_date: document.exported_date,
                uploaded_date: document.delivery_date
            });
        }
    });

    return finalData;
}

/**
 * Convert date to ISO string format (YYYY-MM-DD)
 * @param {Date} date - Date object
 * @returns {String} - Date string in format YYYY-MM-DD
 */
function convertDate(date) {
    return date.toISOString().split('T')[0];
}

module.exports = { getMistake, getQCAmount };
