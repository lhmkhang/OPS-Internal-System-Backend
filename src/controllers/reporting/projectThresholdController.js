const { getProjectThreshold, createOrUpdateProjectThreshold, deleteThresholdItem, deleteProjectThreshold } = require('../../services/reporting');
const { StatusCodes } = require('http-status-codes');
const handleMessage = require('../../utils/HandleMessage');
const message = require('../../utils/message');

/**
 * @swagger
 * /api/v1/reporting/project-threshold:
 *   get:
 *     summary: Get project threshold configuration by projectId
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
 *         description: Project threshold configuration
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
 *                     projectId:
 *                       type: string
 *                     thresholds:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           _id:
 *                             type: string
 *                           thresholdType:
 *                             type: string
 *                           thresholdPercentage:
 *                             type: number
 *                     isActive:
 *                       type: boolean
 *       400:
 *         description: Missing project_id
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
async function getProjectThresholdController(req, res, next) {
    try {
        const data = await getProjectThreshold(req, next);
        return res.status(StatusCodes.OK).json({
            status: 'success',
            code: StatusCodes.OK,
            message: message.PROJECT_THRESHOLD.GET_PROJECT_THRESHOLD_SUCCESS,
            data,
        });
    } catch (error) {
        return next(new handleMessage(error.message || message.PROJECT_THRESHOLD.INTERNAL_SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR));
    }
}

/**
 * @swagger
 * /api/v1/reporting/project-threshold:
 *   post:
 *     summary: Create or update project threshold configuration
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
 *               thresholds:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     thresholdType:
 *                       type: string
 *                       description: Threshold type name
 *                     thresholdPercentage:
 *                       type: number
 *                       minimum: 0
 *                       maximum: 100
 *                       description: Threshold percentage value
 *             required:
 *               - project_id
 *               - thresholds
 *     responses:
 *       200:
 *         description: Project threshold configuration created/updated successfully
 *       400:
 *         description: Missing required fields or invalid data
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
async function createOrUpdateProjectThresholdController(req, res, next) {
    try {
        const data = await createOrUpdateProjectThreshold(req, next);
        return res.status(StatusCodes.OK).json({
            status: 'success',
            code: StatusCodes.OK,
            message: message.PROJECT_THRESHOLD.CREATE_PROJECT_THRESHOLD_SUCCESS,
            data,
        });
    } catch (error) {
        return next(new handleMessage(error.message || message.PROJECT_THRESHOLD.INTERNAL_SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR));
    }
}

/**
 * @swagger
 * /api/v1/reporting/project-threshold/item:
 *   delete:
 *     summary: Delete a specific threshold item from project threshold configuration
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
 *               threshold_id:
 *                 type: string
 *                 description: Threshold item ID to delete
 *             required:
 *               - project_id
 *               - threshold_id
 *     responses:
 *       200:
 *         description: Threshold item deleted successfully
 *       400:
 *         description: Missing required fields
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Project threshold configuration not found
 *       500:
 *         description: Internal server error
 */
async function deleteThresholdItemController(req, res, next) {
    try {
        const data = await deleteThresholdItem(req, next);
        return res.status(StatusCodes.OK).json({
            status: 'success',
            code: StatusCodes.OK,
            message: message.PROJECT_THRESHOLD.DELETE_PROJECT_THRESHOLD_SUCCESS,
            data,
        });
    } catch (error) {
        return next(new handleMessage(error.message || message.PROJECT_THRESHOLD.INTERNAL_SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR));
    }
}

/**
 * @swagger
 * /api/v1/reporting/project-threshold:
 *   delete:
 *     summary: Delete entire project threshold configuration (soft delete)
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
 *             required:
 *               - project_id
 *     responses:
 *       200:
 *         description: Project threshold configuration deleted successfully
 *       400:
 *         description: Missing project_id
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Project threshold configuration not found
 *       500:
 *         description: Internal server error
 */
async function deleteProjectThresholdController(req, res, next) {
    try {
        const data = await deleteProjectThreshold(req, next);
        return res.status(StatusCodes.OK).json({
            status: 'success',
            code: StatusCodes.OK,
            message: message.PROJECT_THRESHOLD.DELETE_PROJECT_THRESHOLD_SUCCESS,
            data,
        });
    } catch (error) {
        return next(new handleMessage(error.message || message.PROJECT_THRESHOLD.INTERNAL_SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR));
    }
}

module.exports = {
    getProjectThresholdController,
    createOrUpdateProjectThresholdController,
    deleteThresholdItemController,
    deleteProjectThresholdController
}; 