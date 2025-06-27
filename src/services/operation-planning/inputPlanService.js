const ProjectPlanDailySchema = require('../../models/ProjectPlanDailyModel');
const { schema: UserSchema, collectionName: UserCollectionName } = require('../../models/userModel');
const { schema: UserRoleSchema, collectionName: UserRoleCollectionName } = require('../../models/UserRoleModel');
const { StatusCodes } = require('http-status-codes');
const handleMessage = require('../../utils/HandleMessage');
const mongoose = require('mongoose');
const { getConnection } = require('../../helpers/connectDB');

// Lấy connection default
const connection = getConnection('default');

// Tạo model từ schema
const ProjectPlanDailyModel = connection.model(ProjectPlanDailySchema.collectionName, ProjectPlanDailySchema.schema);
const UserModel = connection.model(UserCollectionName, UserSchema);
const UserRoleModel = connection.model(UserRoleCollectionName, UserRoleSchema);

// Tính tổng FTE cho mỗi user từ tất cả dự án trừ dự án hiện tại
const getTotalFteByUserExcludingProject = async (projectId, workingDate, session) => {
    // Sử dụng locking để đọc dữ liệu mới nhất từ DB, tránh race condition
    const plans = await ProjectPlanDailyModel.find(
        { workingDate, projectId: { $ne: projectId } },
        null,
        { session, readPreference: 'primary' }
    );

    const totalFteByUser = {};

    plans.forEach(plan => {
        plan.assignments.forEach(assignment => {
            const userIdStr = assignment.userId.toString();
            if (!totalFteByUser[userIdStr]) totalFteByUser[userIdStr] = 0;
            totalFteByUser[userIdStr] += assignment.fte || 0;
        });
    });

    return totalFteByUser;
};

// Tính tổng FTE mới cho mỗi user từ assignments trong request
const getNewFteByUserForProject = (assignments) => {
    const newFteByUser = {};

    assignments.forEach(({ userId, fte }) => {
        const userIdStr = userId.toString();
        if (!newFteByUser[userIdStr]) newFteByUser[userIdStr] = 0;
        newFteByUser[userIdStr] += fte || 0;
    });

    return newFteByUser;
};

const mergeAssignmentsWithChanges = (oldAssignments, newAssignments) => {
    const merged = [...oldAssignments];
    newAssignments.forEach(newAssign => {
        const existingIndex = merged.findIndex(
            old => old.userId.toString() === newAssign.userId.toString() && old.stepName === newAssign.stepName
        );
        if (existingIndex !== -1) {
            // Cập nhật FTE nếu bước đã tồn tại
            merged[existingIndex].fte = newAssign.fte;
        } else {
            // Thêm mới nếu bước chưa tồn tại
            merged.push(newAssign);
        }
    });
    return merged.filter(a => a.fte > 0); // Loại bỏ các bước có FTE = 0
};

const upsertProjectPlanDaily = async (data, userId) => {
    const { projectId, workingDate, steps, assignments, groupPlans } = data;

    // Kiểm tra đầu vào
    if (!projectId || !workingDate || !Array.isArray(assignments)) {
        throw new handleMessage('Missing required fields (projectId, workingDate, assignments)', StatusCodes.BAD_REQUEST);
    }
    if (typeof projectId !== 'string') {
        throw new handleMessage('projectId must be a string', StatusCodes.BAD_REQUEST);
    }

    // Sử dụng session với readConcern "snapshot" để đảm bảo consistent read
    const session = await mongoose.startSession();

    try {
        // Bắt đầu transaction với readConcern "snapshot" để đảm bảo consistent read
        session.startTransaction({
            readConcern: { level: 'snapshot' },
            writeConcern: { w: 'majority' }
        });

        // 1. Lấy bản ghi hiện tại
        const existingPlan = await ProjectPlanDailyModel.findOne(
            { projectId, workingDate },
            null,
            { session }
        );
        const oldAssignments = existingPlan ? existingPlan.assignments : [];
        const oldGroupPlans = existingPlan ? existingPlan.groupPlans : [];

        // 2. Tính tổng FTE cho mỗi user từ tất cả các dự án khác - đảm bảo đọc dữ liệu mới nhất
        const fteByUserFromOtherProjects = await getTotalFteByUserExcludingProject(projectId, workingDate, session);

        // 3. Tính tổng FTE cho mỗi user từ request này
        // Chỉ tính các assignment có fte > 0 để validate
        const validAssignments = assignments.filter(assignment => (assignment.fte || 0) > 0);
        const fteByUserFromRequest = getNewFteByUserForProject(validAssignments);

        // 4. Validate tổng FTE cho mỗi user
        const errors = [];
        for (const [userIdStr, fteFromRequest] of Object.entries(fteByUserFromRequest)) {
            const fteFromOtherProjects = fteByUserFromOtherProjects[userIdStr] || 0;
            const totalFTE = fteFromOtherProjects + fteFromRequest;

            // Log để debug
            console.log(`User ${userIdStr}: FTE from other projects = ${fteFromOtherProjects}, FTE from request = ${fteFromRequest}, Total = ${totalFTE}`);

            if (totalFTE > 1) {
                errors.push({
                    userId: userIdStr,
                    fteFromOtherProjects: fteFromOtherProjects.toFixed(2),
                    fteFromRequest: fteFromRequest.toFixed(2),
                    totalFTE: totalFTE.toFixed(2),
                });
            }
        }

        if (errors.length > 0) {
            const errorMessage = errors
                .map(e => `User ${e.userId}: Other projects ${e.fteFromOtherProjects}, This project ${e.fteFromRequest}, Total ${e.totalFTE} exceeds 1`)
                .join('; ');
            throw new handleMessage(`FTE validation failed: ${errorMessage}`, StatusCodes.BAD_REQUEST);
        }

        // 5. Xử lý assignment để loại bỏ các assignment có fte = 0
        const updatedAssignments = [];

        // 5.1 Xử lý các assignment đã có trong database
        assignments.forEach(newAssignment => {
            // Chỉ thêm các assignment có fte > 0
            if ((newAssignment.fte || 0) > 0) {
                updatedAssignments.push({
                    userId: newAssignment.userId,
                    stepName: newAssignment.stepName,
                    layout: newAssignment.layout || '',
                    section: newAssignment.section || '',
                    fte: newAssignment.fte
                });
            } else {
                // Log việc xóa assignment nếu fte = 0
                console.log(`Removing assignment for user ${newAssignment.userId}, step ${newAssignment.stepName} with fte = 0`);
            }
        });

        // 6. Xử lý groupPlans
        let finalGroupPlans = [];

        // Nếu client gửi groupPlans, cập nhật/xóa theo yêu cầu client
        if (Array.isArray(groupPlans)) {
            // Trường hợp client gửi từ resource-allocation (không có groupPlans) hoặc volume-forecast (có groupPlans)
            if (groupPlans.length > 0) {
                // 6.1. Lọc ra các steps được gửi trong request hiện tại
                const stepNamesInRequest = new Set(groupPlans.map(plan => plan.stepName));

                // 6.2. Giữ lại các group plans của các steps không được gửi trong request hiện tại
                const unchangedGroupPlans = oldGroupPlans.filter(plan => !stepNamesInRequest.has(plan.stepName));

                // 6.3. Xử lý các group plans mới cho các steps trong request
                const updatedGroupPlans = [];
                groupPlans.forEach(plan => {
                    // Chỉ thêm vào nếu có allocatedVolume > 0
                    if (plan && Number(plan.allocatedVolume) > 0) {
                        updatedGroupPlans.push({
                            groupId: plan.groupId,
                            stepName: plan.stepName,
                            allocatedVolume: Number(plan.allocatedVolume) || 0,
                            realVolume: Number(plan.realVolume) || 0,
                            totalWorkingTime: Number(plan.totalWorkingTime) || 0,
                            overtime: plan.overtime || false,
                            realSpeed: plan.realSpeed || '',
                            layout: plan.layout || '',
                            section: plan.section || '',
                            unit: plan.unit || '',
                            timePerDoc: Number(plan.timePerDoc) || 0,
                            productiveHours: Number(plan.productiveHours) || 0
                        });
                    } else if (plan) {
                        // Log việc xóa groupPlan nếu allocatedVolume = 0
                        console.log(`Removing group plan for group ${plan.groupId}, step ${plan.stepName} with allocatedVolume = 0`);
                    }
                });

                // 6.4. Hợp nhất danh sách: giữ nguyên các steps không thay đổi và cập nhật/xóa các steps được gửi
                finalGroupPlans = [...unchangedGroupPlans, ...updatedGroupPlans];
            } else {
                // Client không gửi groupPlans - giữ nguyên groupPlans cũ
                finalGroupPlans = oldGroupPlans;
            }
        } else {
            // Nếu client không gửi groupPlans array (undefined/null), giữ nguyên groupPlans cũ
            finalGroupPlans = oldGroupPlans;
        }

        // 7. Lưu dữ liệu với version check để đảm bảo không có race condition
        const updated = await ProjectPlanDailyModel.findOneAndUpdate(
            { projectId, workingDate },
            {
                steps,
                assignments: updatedAssignments,
                groupPlans: finalGroupPlans,
                modifiedBy: userId,
                modifiedDate: new Date(),
            },
            { upsert: true, new: true, runValidators: true, session }
        );

        // Double-check sau khi lưu để đảm bảo không có race condition
        const finalFteCheck = await verifyTotalFteNotExceeded(workingDate, session);
        if (!finalFteCheck.valid) {
            throw new handleMessage(`FTE validation failed after save: ${finalFteCheck.errorMessage}`, StatusCodes.CONFLICT);
        }

        // 8. Commit transaction
        await session.commitTransaction();
        return updated;
    } catch (error) {
        // 9. Rollback nếu có lỗi
        await session.abortTransaction();
        throw error;
    } finally {
        // 10. Đóng session
        session.endSession();
    }
};

// Hàm mới để kiểm tra xem có user nào bị assign quá 1 FTE trong một ngày không
const verifyTotalFteNotExceeded = async (workingDate, session) => {
    // Lấy tất cả plan của ngày đó để kiểm tra
    const allPlansForDay = await ProjectPlanDailyModel.find(
        { workingDate },
        null,
        { session, readPreference: 'primary' }
    );

    // Tính tổng FTE cho mỗi user từ tất cả project
    const totalFteByUser = {};
    allPlansForDay.forEach(plan => {
        plan.assignments.forEach(assignment => {
            const userIdStr = assignment.userId.toString();
            if (!totalFteByUser[userIdStr]) totalFteByUser[userIdStr] = 0;
            totalFteByUser[userIdStr] += assignment.fte || 0;
        });
    });

    // Kiểm tra xem có user nào vượt quá 1 FTE không
    const errors = [];
    for (const [userIdStr, totalFte] of Object.entries(totalFteByUser)) {
        if (totalFte > 1) {
            errors.push({
                userId: userIdStr,
                totalFTE: totalFte.toFixed(2)
            });
        }
    }

    if (errors.length > 0) {
        const errorMessage = errors
            .map(e => `User ${e.userId}: Total FTE across all projects ${e.totalFTE} exceeds 1`)
            .join('; ');
        return { valid: false, errorMessage };
    }

    return { valid: true };
};

const getProjectPlanDaily = async (workingDate) => {
    if (!workingDate) {
        throw new handleMessage('Missing workingDate', StatusCodes.BAD_REQUEST);
    }
    const record = await ProjectPlanDailyModel.find({ workingDate });
    // Đảm bảo trả về cả groupPlans nếu có
    return record || null;
};

// Hàm cung cấp thông tin cơ bản khi login (từ planningCoreService)
const getPlanInitData = async (req) => {
    const username = req.user;

    if (!username) {
        throw new handleMessage('Username not provided', StatusCodes.UNAUTHORIZED);
    }

    const currentUser = await UserModel.findOne({ username }).select('_id username');
    if (!currentUser) {
        throw new handleMessage('User not found', StatusCodes.NOT_FOUND);
    }
    const userId = currentUser._id;

    const userRoles = await UserRoleModel.find({ userId: { $in: [userId] } }).select('role priority -_id').lean();

    if (!userRoles || userRoles.length === 0) {
        return {
            currentUser: {
                userId,
                username: currentUser.username,
                roles: [{ role: 'VIEWER', priority: Infinity }],
            }
        };
    }

    const primaryRole = userRoles.reduce((prev, curr) =>
        prev.priority < curr.priority ? prev : curr,
        userRoles[0]
    );

    return {
        currentUser: {
            userId,
            username: currentUser.username,
            roles: [primaryRole],
        }
    };
};

module.exports = {
    getTotalFteByUserExcludingProject,
    getNewFteByUserForProject,
    mergeAssignmentsWithChanges,
    upsertProjectPlanDaily,
    verifyTotalFteNotExceeded,
    getProjectPlanDaily,
    getPlanInitData
}; 