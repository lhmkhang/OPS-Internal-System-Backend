const { getMistakeReport, updateErrorType, getMistakeForPM } = require('../../services/reporting');
const { StatusCodes } = require('http-status-codes');
const handleMessage = require('../../utils/HandleMessage');
const message = require('../../utils/message');

/**
 * @swagger
 * /api/v1/reporting/mistake-report:
 *   get:
 *     summary: Lấy danh sách report mistake theo project và ngày
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
 *         name: date
 *         schema:
 *           type: string
 *           format: date
 *         description: Ngày cần truy vấn (yyyy-mm-dd)
 *       - in: query
 *         name: date_from
 *         schema:
 *           type: string
 *           format: date
 *         description: Ngày bắt đầu (yyyy-mm-dd)
 *       - in: query
 *         name: date_to
 *         schema:
 *           type: string
 *           format: date
 *         description: Ngày kết thúc (yyyy-mm-dd)
 *       - in: query
 *         name: include_all_statuses
 *         schema:
 *           type: boolean
 *         description: Khi true, lấy tất cả mistakes không filter theo status. Khi false/null, chỉ lấy status WAIT_QC và REJECTED_BY_PM với error_found_at=qc (mặc định)
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
        const data = await getMistakeReport(req, next);
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

/**
 * PATCH /api/v1/reporting/mistake-report/error-type
 * Body: { project_id, doc_id, error_id, error_type }
 */
async function updateErrorTypeController(req, res, next) {
    try {
        const result = await updateErrorType(req, next);
        return res.status(StatusCodes.OK).json({
            status: 'success',
            code: StatusCodes.OK,
            message: message.REPORTING.UPDATE_ERROR_TYPE_SUCCESS,
            data: result,
        });
    } catch (error) {
        console.log(error);

        return next(new handleMessage(error.message || message.REPORTING.INTERNAL_SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR));
    }
}

// GET /api/v1/reporting/mistake-report/pm
async function getMistakeForPMController(req, res, next) {
    try {
        const data = await getMistakeForPM(req, next);
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
    updateErrorTypeController,
    getMistakeForPMController
}; 