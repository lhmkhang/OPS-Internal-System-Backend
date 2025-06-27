const { getConnection } = require('../helpers/connectDB');
const { schema: AppSchema, collectionName: AppCollectionName } = require('../models/AppModel');

/**
 * Transform routes from database format to client format
 * @param {Array} routes - Routes array from database
 * @returns {Array} - Transformed routes array
 */
const transformRoutes = (routes, depth = 0) => {
    if (!Array.isArray(routes)) {
        return [];
    }
    return routes.map((route, index) => {
        const transformedRoute = {
            path: route.path,
            title: route.title
        };

        // Add optional properties if they exist
        if (route.isTopLevel !== undefined) {
            transformedRoute.isTopLevel = route.isTopLevel;
        }

        if (route.description) {
            transformedRoute.description = route.description;
        }

        // Add permissions if they exist
        if (route.permissions) {
            transformedRoute.permissions = {
                roles: route.permissions.roles || [],
                isPublic: route.permissions.isPublic || false
            };
        }

        // Recursively transform children if they exist
        if (route.children && Array.isArray(route.children)) {
            transformedRoute.children = transformRoutes(route.children, depth + 1);
        }

        return transformedRoute;
    });
};

/**
 * Get routes configuration from apps collection and transform to client format
 * @returns {Object} - Routes configuration in NEXT_PUBLIC_ROUTES_CONFIG format
 */
const getRoutesConfig = async () => {
    try {
        const defaultConnection = getConnection('default');

        if (!defaultConnection || defaultConnection.readyState !== 1) {
            throw new Error('Default database connection is not available');
        }

        const AppModel = defaultConnection.models[AppCollectionName] ||
            defaultConnection.model(AppCollectionName, AppSchema, AppCollectionName);

        // Get all apps sorted by sortOrder
        const apps = await AppModel.find({}).sort({ sortOrder: 1 }).lean();

        if (!apps || apps.length === 0) {
            return { routes: [] };
        }

        // Transform all routes from all apps into single routes array
        const allRoutes = [];

        for (const app of apps) {
            if (app.routes && Array.isArray(app.routes)) {
                const transformedRoutes = transformRoutes(app.routes);
                allRoutes.push(...transformedRoutes);
            }
        }

        return {
            routes: allRoutes
        };

    } catch (error) {
        console.error('[getRoutesConfig] Error:', error);
        throw new Error(`Failed to get routes config: ${error.message}`);
    }
};

module.exports = {
    getRoutesConfig
}; 