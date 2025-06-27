const LODASH = require('lodash');

function compareEnrichData(enrichData, document, projectId, batchId, multiRowSections = [], fieldNotCount = [], result = []) {
    const currentDate = new Date();
    const stepKeys = Object.keys(enrichData).filter(key => Array.isArray(enrichData[key]));

    // Tìm tất cả system_record_id xuất hiện ở mọi step
    const allSystemRecordIds = new Set();
    stepKeys.forEach(step => {
        enrichData[step].forEach(recordObj => {
            Object.keys(recordObj).forEach(sysId => {
                allSystemRecordIds.add(sysId);
            });
        });
    });

    stepKeys.forEach((step, stepIndex) => {
        if (stepIndex === stepKeys.length - 1) return;
        const stepArr = enrichData[step];
        const finalStep = stepKeys[stepKeys.length - 1];
        const finalArr = enrichData[finalStep];

        // Convert arr thành map
        const stepMap = {};
        stepArr.forEach(recordObj => {
            Object.keys(recordObj).forEach(sysId => {
                stepMap[sysId] = recordObj[sysId];
            });
        });
        const finalMap = {};
        finalArr.forEach(recordObj => {
            Object.keys(recordObj).forEach(sysId => {
                finalMap[sysId] = recordObj[sysId];
            });
        });

        allSystemRecordIds.forEach(system_record_id => {
            const currentRecord = stepMap[system_record_id] || {};
            const finalRecord = finalMap[system_record_id] || {};

            // Lấy tất cả các section xuất hiện ở hai step này
            const allSections = new Set([
                ...Object.keys(currentRecord),
                ...Object.keys(finalRecord)
            ]);

            allSections.forEach(section => {
                const entry = currentRecord[section] || {};
                const finalEntry = finalRecord[section] || {};
                const isMultiRow = multiRowSections.includes(section);

                if (isMultiRow) {
                    // So sánh từng dòng theo line_line_id
                    const allLineIds = new Set();
                    if (Array.isArray(entry.data)) {
                        entry.data.forEach(row => {
                            if (row.line_line_id?.text) allLineIds.add(row.line_line_id.text);
                        });
                    }
                    if (Array.isArray(finalEntry.data)) {
                        finalEntry.data.forEach(row => {
                            if (row.line_line_id?.text) allLineIds.add(row.line_line_id.text);
                        });
                    }
                    allLineIds.forEach(lineId => {
                        const curRow = (entry.data || []).find(r => r.line_line_id?.text === lineId) || {};
                        const finalRow = (finalEntry.data || []).find(r => r.line_line_id?.text === lineId) || {};

                        if (Object.keys(curRow).length === 0 && Object.keys(finalRow).length > 0) {
                            for (const field of Object.keys(finalRow)) {
                                if (field === 'line_line_id' || fieldNotCount.includes(field)) continue;
                                result.push(buildMistake(projectId, batchId, document, step, finalStep, system_record_id, section, lineId, field, '', finalRow[field]?.text || '', entry.keyer, finalEntry.keyer, entry.createdtime, finalEntry.createdtime, currentDate));
                            }
                            return;
                        }

                        if (Object.keys(finalRow).length === 0 && Object.keys(curRow).length > 0) {
                            for (const field of Object.keys(curRow)) {
                                if (field === 'line_line_id' || fieldNotCount.includes(field)) continue;
                                result.push(buildMistake(projectId, batchId, document, step, finalStep, system_record_id, section, lineId, field, curRow[field]?.text || '', '', entry.keyer, finalEntry.keyer, entry.createdtime, finalEntry.createdtime, currentDate));
                            }
                            return;
                        }

                        const allFields = new Set([...Object.keys(curRow), ...Object.keys(finalRow)]);
                        allFields.forEach(field => {
                            if (field === 'line_line_id' || fieldNotCount.includes(field)) return;
                            const curVal = curRow[field]?.text || '';
                            const finalVal = finalRow[field]?.text || '';
                            if (curVal !== finalVal) {
                                result.push(buildMistake(projectId, batchId, document, step, finalStep, system_record_id, section, lineId, field, curVal, finalVal, entry.keyer, finalEntry.keyer, entry.createdtime, finalEntry.createdtime, currentDate));
                            }
                        });
                    });
                } else {
                    // Single row (ví dụ Meta, Header)
                    const curData = entry.data?.[0] || {};
                    const finalData = finalEntry.data?.[0] || {};

                    if (Object.keys(curData).length === 0 && Object.keys(finalData).length > 0) {
                        for (const field of Object.keys(finalData)) {
                            if (fieldNotCount.includes(field)) continue;
                            result.push(buildMistake(projectId, batchId, document, step, finalStep, system_record_id, section, '', field, '', finalData[field]?.text || '', entry.keyer, finalEntry.keyer, entry.createdtime, finalEntry.createdtime, currentDate));
                        }
                        return;
                    }

                    if (Object.keys(finalData).length === 0 && Object.keys(curData).length > 0) {
                        for (const field of Object.keys(curData)) {
                            if (fieldNotCount.includes(field)) continue;
                            result.push(buildMistake(projectId, batchId, document, step, finalStep, system_record_id, section, '', field, curData[field]?.text || '', '', entry.keyer, finalEntry.keyer, entry.createdtime, finalEntry.createdtime, currentDate));
                        }
                        return;
                    }

                    const allFields = new Set([...Object.keys(curData), ...Object.keys(finalData)]);

                    allFields.forEach(field => {
                        if (fieldNotCount.includes(field)) return;
                        const curVal = curData[field]?.text || '';
                        const finalVal = finalData[field]?.text || '';
                        if (curVal !== finalVal) {
                            result.push(buildMistake(projectId, batchId, document, step, finalStep, system_record_id, section, '', field, curVal, finalVal, entry.keyer, finalEntry.keyer, entry.createdtime, finalEntry.createdtime, currentDate));
                        }
                    });
                }
            });
        });
    });
    return result;
}

/**
 * Chuẩn hóa id, detect rework và group lại thành step → array[system_record_id → sections]
 * @param {Array} dataFiltered
 * @param {Object} document_history
 * @returns {Object} { [task_def_key/rework_xxx]: [ { [system_record_id]: { section: node, ... } }, ... ] }
 */

function assignIdsBuildTaskAndGroupByRecord(dataFiltered, document_history) {
    // 1. Build lookup map cho document_history
    const keyed_data_map = {};
    // Xây dựng mapping mảng cho từng step-section
    for (const key in document_history.keyed_data) {
        const [task_id, task_def_key, ...rest] = key.split('|');
        const arr = document_history.keyed_data[key];
        arr.forEach(entry => {
            entry.section.forEach(sectionObj => {
                const section = sectionObj.section;
                const mapKey = `${task_id}|${task_def_key}|${section}`;
                keyed_data_map[mapKey] = keyed_data_map[mapKey] || [];
                keyed_data_map[mapKey].push({
                    system_record_id: entry.system_record_id,
                    line_ids: Array.isArray(sectionObj.data) ? sectionObj.data : [],
                });
            });
        });
    }

    // Đếm thứ tự xuất hiện keyed_data cho mỗi (task_id, task_def_key, section)
    const keyedDataCountMap = {}; // key: `${task_id}|${task_def_key}|${section}` value: count

    dataFiltered.forEach(record => {
        (record.keyed_data || []).forEach(node => {
            const { task_id, task_def_key, section } = node;
            const mapKey = `${task_id}|${task_def_key}|${section}`;
            const mappingArr = keyed_data_map[mapKey];
            if (!mappingArr) return;

            keyedDataCountMap[mapKey] = keyedDataCountMap[mapKey] || 0;
            const idx = keyedDataCountMap[mapKey];
            const foundMapping = mappingArr[idx];

            if (!foundMapping) {
                // Nếu mappingArr ít hơn số record thực tế, dùng phần tử cuối cùng cho các record dư (tránh undefined)
                node.system_record_id = mappingArr.length > 0 ? mappingArr[mappingArr.length - 1].system_record_id : null;
            } else {
                node.system_record_id = foundMapping.system_record_id;
                // Nếu là section có nhiều dòng, gán lại line_id
                if (Array.isArray(node.data) && foundMapping.line_ids.length > 0) {
                    node.data.forEach((row, i) => {
                        if (
                            row.line_line_id &&
                            (!row.line_line_id.text || row.line_line_id.text === "")
                        ) {
                            row.line_line_id.text = foundMapping.line_ids[i] || "";
                        }
                    });
                }
            }

            keyedDataCountMap[mapKey]++;
        });
    });

    // === Build human_task và group theo system_record_id như cũ ===
    const allKeyedData = [];
    dataFiltered.forEach(record => {
        if (Array.isArray(record.keyed_data)) {
            allKeyedData.push(...record.keyed_data);
        }
    });

    const groupedData = LODASH.groupBy(allKeyedData, 'task_def_key');
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

    // 4. Group theo system_record_id trong từng step (task_def_key/rework)
    const result = {};
    for (const stepKey in human_task) {
        const stepArr = human_task[stepKey];
        const groupedByRecord = LODASH.groupBy(stepArr, 'system_record_id');
        result[stepKey] = Object.keys(groupedByRecord).map(system_record_id => {
            const sections = {};
            groupedByRecord[system_record_id].forEach(node => {
                sections[node.section] = node;
            });
            return { [system_record_id]: sections };
        });
    }
    return result;
}


/**
 * Hàm so sánh và trả về dữ liệu sai lệch giữa các bước (mapping theo id)
 * @param {Array} fieldNotCount
 * @param {Object} document
 * @param {Array} dataFiltered
 * @param {String} projectId
 * @param {String} batchId
 * @param {Object} documentHistory (bắt buộc)
 * @returns {Array}
 */

function getMistake(fieldNotCount, document, dataFiltered, projectId, batchId, documentHistory, sectionMultiRow = ["Line"]) {
    const result = [];
    const enrichData = assignIdsBuildTaskAndGroupByRecord(dataFiltered, documentHistory[0])

    console.log(JSON.stringify(enrichData));


    result.push(compareEnrichData(enrichData, document, projectId, batchId, sectionMultiRow, fieldNotCount))
    return result;
}

function buildMistake(document, taskKey, taskFinal, recordIdx, section, lineIdx, field, valKeyer, valFinal, timeKeyer, timeFinal) {
    return {
        // metadata ngoài sẽ được lấy ở cron, chỉ giữ field-level cho từng lỗi
        task_keyer_name: taskKey,
        task_final_name: taskFinal,
        section: section,
        record_idx: recordIdx,
        line_idx: lineIdx,
        field_name: field,
        value_keyer: valKeyer,
        value_final: valFinal,
        captured_keyer_at: timeKeyer,
        captured_final_at: timeFinal,
        layout_name: document.layout_name,
        error_type: null // sẽ được cập nhật từ UI
    };
}

/**
 * Hàm tính số lượng field, ký tự được thực hiện trong quá trình QC
 * @param {String} filterControl - Kiểu lọc (field/character)
 * @param {Array} fieldNotCount - Danh sách field không tính
 * @param {Object} document - Document từ MongoDB
 * @param {Array} dataFiltered - Dữ liệu đã lọc
 * @param {String} projectId - ID dự án
 * @param {String} batchId - ID batch
 * @returns {Array} - Danh sách QC effort theo cấu trúc mới
 */

function getQCAmountByStep(document, dataFiltered, projectId, batchId, documentHistory, sectionMultiRow = ["Line"], fieldNotCount = []) {
    const enrichData = assignIdsBuildTaskAndGroupByRecord(dataFiltered, documentHistory);
    const currentDate = new Date();
    const QC_PATTERN = /_qc_|_aqc_|quality_check|approve_mistake/i;
    const stepKeys = Object.keys(enrichData);
    const lastStepKey = stepKeys[stepKeys.length - 1];
    const result = [];

    for (const stepKey of stepKeys) {
        const stepArr = enrichData[stepKey] || [];
        let total_field = 0;
        let total_character = 0;
        let total_records = stepArr.length;
        let total_lines = 0;
        let user_name_keyer = null;
        let layout_name = document.layout_name;
        let captured_keyer_at = null;
        let imported_date = document.created_date || currentDate;
        let exported_date = document.exported_date;
        let uploaded_date = document.delivery_date;

        // Count logic
        for (const recordObj of stepArr) {
            const system_record_id = Object.keys(recordObj)[0];
            const sections = recordObj[system_record_id];
            for (const section in sections) {
                const node = sections[section];
                if (!user_name_keyer) user_name_keyer = node.keyer;
                if (!captured_keyer_at) captured_keyer_at = node.createdtime;

                // Multi-row section
                if (sectionMultiRow.includes(section)) {
                    if (Array.isArray(node.data)) {
                        total_lines += node.data.length;
                        for (const row of node.data) {
                            for (const field in row) {
                                if (fieldNotCount.includes(field)) continue;
                                total_field += 1;
                                total_character += (row[field]?.text?.length || 0);
                            }
                        }
                    }
                } else { // Single-row section
                    if (Array.isArray(node.data) && node.data[0]) {
                        const row = node.data[0];
                        for (const field in row) {
                            if (fieldNotCount.includes(field)) continue;
                            total_field += 1;
                            total_character += (row[field]?.text?.length || 0);
                        }
                    }
                }
            }
        }

        // is_qc logic
        const isStepQC = QC_PATTERN.test(stepKey);
        let is_qc = false;
        if (!isStepQC && QC_PATTERN.test(lastStepKey)) {
            is_qc = true;
        }

        result.push({
            project_id: projectId,
            batch_id: batchId,
            batch_name: document.batch_name,
            doc_id: document._id,
            user_name_keyer,
            task_keyer_name: stepKey,
            layout_name,
            total_field,
            total_character,
            total_records,
            total_lines,
            is_qc,
            captured_keyer_at,
            compared_at: currentDate,
            imported_date,
            exported_date,
            uploaded_date
        });
    }
    return result;
}

module.exports = { getMistake, getQCAmountByStep };
