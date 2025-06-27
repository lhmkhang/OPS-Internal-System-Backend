const { StatusCodes } = require('http-status-codes');
const message = require('../utils/message');
const handleMessage = require('../utils/HandleMessage');
const appService = require('../services/appService');

const getRoutesConfig = async (req, res, next) => {
    try {
        const routesConfig = await appService.getRoutesConfig();

        return res.status(StatusCodes.OK).json({
            status: 'success',
            code: StatusCodes.OK,
            message: message.APP.GET_ROUTES_CONFIG_SUCCESS,
            data: routesConfig
        });
    } catch (error) {
        return next(new handleMessage(error.message || message.APP.GET_ROUTES_CONFIG_FAILED, StatusCodes.INTERNAL_SERVER_ERROR));
    }
};

module.exports = {
    getRoutesConfig
}; 