const { getMistakeReport } = require('../services/reportingService');
const { StatusCodes } = require('http-status-codes');
const handleMessage = require('../utils/HandleMessage');
const message = require('../utils/message');

/**
 * @swagger
 * /api/v1/reporting/mistake-report:
 *   get:
 *     summary: Lấy danh sách report mistake theo project và ngày
 *     tags:
 *       - Reporting
 *     parameters:
 *       - in: query
 *         name: projectId
 *         required: true
 *         schema:
 *           type: string
 *         description: Project ID
 *       - in: query
 *         name: date
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *         description: Ngày cần truy vấn (yyyy-mm-dd)
 *     responses:
 *       200:
 *         description: Danh sách report mistake
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
 *                     items:
 *                       type: array
 *                       items:
 *                         type: object
 *                     total:
 *                       type: number
 *       400:
 *         description: Thiếu hoặc sai tham số
 *       500:
 *         description: Lỗi server
 */
async function getMistakeReportController(req, res, next) {
    try {
        const data = await getMistakeReport(req);
        return res.status(StatusCodes.OK).json({
            status: 'success',
            code: StatusCodes.OK,
            message: message.REPORTING.GET_MISTAKE_REPORT_SUCCESS,
            data,
        });
    } catch (error) {
        return next(new handleMessage(error.message || message.REPORTING.INTERNAL_SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR));
    }
}

module.exports = {
    getMistakeReportController,
}; 