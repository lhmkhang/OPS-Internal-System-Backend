# Reporting Routers Refactoring

## Tổng quan
File `reportingApiRouters.js` gốc đã được tách thành 5 modules nhỏ hơn theo chức năng.

## Cấu trúc mới

### 1. mistakeManagementRoutes.js
- QC operations routes
- GET /api/v1/reporting/mistake-report
- PATCH /api/v1/reporting/mistake-report/error-type
- GET /api/v1/reporting/mistake-report/pm

### 2. mistakeApprovalRoutes.js
- PM approval operations routes
- PATCH /api/v1/reporting/mistake-report/approve
- PATCH /api/v1/reporting/mistake-report/reject
- PATCH /api/v1/reporting/mistake-report/batch-error-type
- PATCH /api/v1/reporting/mistake-report/batch-approve-reject

### 3. qualityStatsRoutes.js
- Quality statistics routes
- GET /api/v1/reporting/project-quality-stats
- GET /api/v1/reporting/all-projects-quality-stats

### 4. fieldConfigurationRoutes.js
- Field configuration routes
- GET /api/v1/reporting/field-configuration
- PATCH /api/v1/reporting/field-configuration

### 5. projectThresholdRoutes.js
- Project threshold routes
- GET /api/v1/reporting/project-threshold
- POST /api/v1/reporting/project-threshold
- DELETE /api/v1/reporting/project-threshold/item
- DELETE /api/v1/reporting/project-threshold

### 6. index.js
- Initialize all route modules

## Migration Process
Files updated:
- back-end/src/server.js
- back-end/src/routers/index.js

All routes maintain same paths and middleware.

## Benefits
- Modular structure
- Easier maintenance
- Clear separation of concerns
- Better scalability 