const { getProjectQualityStats, getAllProjectsQualityStats } = require('../../services/reporting');
const { StatusCodes } = require('http-status-codes');
const handleMessage = require('../../utils/HandleMessage');
const message = require('../../utils/message');

/**
 * @swagger
 * /api/v1/reporting/project-quality-stats:
 *   get:
 *     summary: Lấy thông tin chất lượng dự án theo document hoặc field level
 *     tags:
 *       - Reporting
 *     parameters:
 *       - in: query
 *         name: project_id
 *         required: true
 *         schema:
 *           type: string
 *         description: Project ID
 *       - in: query
 *         name: date_from
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *         description: Ngày bắt đầu (yyyy-mm-dd)
 *       - in: query
 *         name: date_to
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *         description: Ngày kết thúc (yyyy-mm-dd)
 *       - in: query
 *         name: report_level
 *         required: true
 *         schema:
 *           type: string
 *           enum: [document, field]
 *         description: Cấp độ báo cáo (document/field)
 *     responses:
 *       200:
 *         description: Thông tin chất lượng dự án
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                 code:
 *                   type: number
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     total_error:
 *                       type: number
 *                       description: Tổng số lỗi (document hoặc field tùy theo report_level)
 *                     total_keying:
 *                       type: number
 *                       description: Tổng số thao tác nhập liệu (document hoặc field tùy theo report_level)
 *                     total_sample:
 *                       type: number
 *                       description: Tổng số thao tác được kiểm định (document hoặc field tùy theo report_level)
 *       400:
 *         description: Thiếu hoặc sai tham số
 *       500:
 *         description: Lỗi server
 */
async function getProjectQualityStatsController(req, res, next) {
    try {
        const data = await getProjectQualityStats(req, next);

        // Nếu service trả về null, có nghĩa là đã xảy ra lỗi và service đã gọi next(error)
        // Trong trường hợp này, không gửi response thêm nữa
        if (data === null) {
            return; // Không gửi response, vì middleware xử lý lỗi sẽ làm điều đó
        }

        return res.status(StatusCodes.OK).json({
            status: 'success',
            code: StatusCodes.OK,
            message: message.REPORTING.GET_PROJECT_QUALITY_STATS_SUCCESS,
            data,
        });
    } catch (error) {
        return next(new handleMessage(error.message || message.REPORTING.INTERNAL_SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR));
    }
}

/**
 * @swagger
 * /api/v1/reporting/all-projects-quality-stats:
 *   get:
 *     summary: Lấy thông tin chất lượng tất cả dự án và tất cả report levels theo date range
 *     tags:
 *       - Reporting
 *     parameters:
 *       - in: query
 *         name: date_from
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *         description: Ngày bắt đầu (yyyy-mm-dd)
 *       - in: query
 *         name: date_to
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *         description: Ngày kết thúc (yyyy-mm-dd)

 *     responses:
 *       200:
 *         description: Thông tin chất lượng tất cả dự án cho tất cả report levels (document, field, record, line_item)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                 code:
 *                   type: number
 *                 message:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       project_id:
 *                         type: string
 *                         description: Project ID
 *                       project_name:
 *                         type: string
 *                         description: Project name
 *                       report_level:
 *                         type: string
 *                         description: Report level (document/field/record/line_item)
 *                       category:
 *                         type: string
 *                         description: Category (overall, Critical, Non Critical, etc.)
 *                       category_name:
 *                         type: string
 *                         description: Category display name (Document, Field, etc.)
 *                       imported_date:
 *                         type: string
 *                         format: date
 *                         description: Imported date (YYYY-MM-DD)
 *                       total_error:
 *                         type: number
 *                         description: Total errors
 *                       total_keying:
 *                         type: number
 *                         description: Total keying count
 *                       total_sample:
 *                         type: number
 *                         description: Total sample count
 *                       threshold_type:
 *                         type: string
 *                         description: Threshold type
 *                       threshold:
 *                         type: number
 *                         nullable: true
 *                         description: Threshold percentage
 *       400:
 *         description: Thiếu hoặc sai tham số
 *       500:
 *         description: Lỗi server
 */
async function getAllProjectsQualityStatsController(req, res, next) {
    try {
        const data = await getAllProjectsQualityStats(req, next);

        // Nếu service trả về null, có nghĩa là đã xảy ra lỗi và service đã gọi next(error)
        if (data === null) {
            return; // Không gửi response, vì middleware xử lý lỗi sẽ làm điều đó
        }

        return res.status(StatusCodes.OK).json({
            status: 'success',
            code: StatusCodes.OK,
            message: message.REPORTING.GET_ALL_PROJECTS_QUALITY_STATS_SUCCESS || 'Get all projects quality stats successfully',
            data,
        });
    } catch (error) {
        return next(new handleMessage(error.message || message.REPORTING.INTERNAL_SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR));
    }
}

module.exports = {
    getProjectQualityStatsController,
    getAllProjectsQualityStatsController
}; 