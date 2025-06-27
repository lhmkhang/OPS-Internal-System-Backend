const { getFieldConfiguration, updateFieldConfiguration } = require('../../services/reporting');
const { StatusCodes } = require('http-status-codes');
const handleMessage = require('../../utils/HandleMessage');
const message = require('../../utils/message');

/**
 * @swagger
 * /api/v1/reporting/field-configuration:
 *   get:
 *     summary: Lấy danh sách field configuration theo project_id
 *     tags:
 *       - Reporting
 *     parameters:
 *       - in: query
 *         name: project_id
 *         required: true
 *         schema:
 *           type: string
 *         description: Project ID
 *     responses:
 *       200:
 *         description: Danh sách field configuration
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
 *                       _id:
 *                         type: string
 *                       field_name:
 *                         type: string
 *                       field_display:
 *                         type: string
 *                       is_report_count:
 *                         type: boolean
 *                       critical_field:
 *                         type: string
 *                         nullable: true
 *                         description: Threshold type (bất kỳ string nào hoặc null)
 *                       layout_name:
 *                         type: string
 *                       section_name:
 *                         type: string
 *       400:
 *         description: Thiếu project_id
 *       401:
 *         description: Không có quyền truy cập
 *       500:
 *         description: Lỗi server
 */
async function getFieldConfigurationController(req, res, next) {
    try {
        const data = await getFieldConfiguration(req, next);
        return res.status(StatusCodes.OK).json({
            status: 'success',
            code: StatusCodes.OK,
            message: message.REPORTING.GET_FIELD_CONFIGURATION_SUCCESS,
            data,
        });
    } catch (error) {
        return next(new handleMessage(error.message || message.REPORTING.INTERNAL_SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR));
    }
}

/**
 * @swagger
 * /api/v1/reporting/field-configuration:
 *   patch:
 *     summary: Update is_report_count và critical_field cho một hoặc nhiều field
 *     tags:
 *       - Reporting
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               project_id:
 *                 type: string
 *                 description: Project ID
 *               fields:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     field_id:
 *                       type: string
 *                       description: Field ID (_id từ collection field_configuration)
 *                     is_report_count:
 *                       type: boolean
 *                       description: Có đếm report hay không (optional)
 *                     critical_field:
 *                       type: string
 *                       nullable: true
 *                       description: Threshold type (bất kỳ string nào hoặc null) (optional)
 *             required:
 *               - project_id
 *               - fields
 *     responses:
 *       200:
 *         description: Update thành công
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
 *                     total_fields:
 *                       type: number
 *                     success_count:
 *                       type: number
 *                     results:
 *                       type: array
 *       400:
 *         description: Thiếu tham số hoặc dữ liệu không hợp lệ
 *       401:
 *         description: Không có quyền truy cập
 *       500:
 *         description: Lỗi server
 */
async function updateFieldConfigurationController(req, res, next) {
    try {
        const data = await updateFieldConfiguration(req, next);
        return res.status(StatusCodes.OK).json({
            status: 'success',
            code: StatusCodes.OK,
            message: message.REPORTING.UPDATE_FIELD_CONFIGURATION_SUCCESS,
            data,
        });
    } catch (error) {
        return next(new handleMessage(error.message || message.REPORTING.INTERNAL_SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR));
    }
}

module.exports = {
    getFieldConfigurationController,
    updateFieldConfigurationController
}; 