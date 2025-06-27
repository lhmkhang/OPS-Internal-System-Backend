const mongoose = require('mongoose');

const permissionSchema = new mongoose.Schema({
    roles: {
        type: [String],
        enum: ['ADMIN', 'PROJECT_MANAGER', 'LINE_MANAGER', 'TEAM_LEADER', 'VIEWER']
    },
    isPublic: {
        type: Boolean,
        default: false
    }
}, { _id: false });

const routeSchema = new mongoose.Schema({
    path: {
        type: String,
        required: true
    },
    title: {
        type: String,
        required: true
    },
    isTopLevel: {
        type: Boolean
    },
    description: {
        type: String
    },
    permissions: {
        type: permissionSchema
    }
}, { _id: false });

// Self-referencing for nested children
routeSchema.add({
    children: [routeSchema]
});

const schema = new mongoose.Schema({
    appId: {
        type: String,
        required: true,
        unique: true
    },
    name: {
        type: String,
        required: true
    },
    title: {
        type: String,
        required: true
    },
    description: {
        type: String
    },
    icon: {
        type: String
    },
    category: {
        type: String,
        enum: ['main', 'module', 'utility']
    },
    permissions: {
        type: permissionSchema
    },
    routes: [routeSchema],
    sortOrder: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true,
    collection: 'apps'
});

const collectionName = 'apps';

module.exports = { schema, collectionName }; 