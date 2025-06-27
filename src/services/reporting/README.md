# Reporting Service Refactoring

## Tổng quan
File `reportingService.js` gốc (3580 dòng code) đã được tách thành các module nhỏ hơn theo chức năng để dễ bảo trì và phát triển.

## Cấu trúc sau khi tách

### 1. `reportingHelpers.js` (541 dòng)
**Chức năng:** Helper functions và utilities dùng chung

**Functions:**
- `getFieldConfigByVersion()` - Lấy field configuration theo version với cache
- `getProjectThresholdByVersion()` - Lấy project threshold theo version với cache  
- `groupDocumentsByVersions()` - Group documents theo date + config versions
- `getThresholdPercentageByVersion()` - Lấy threshold percentage theo version
- `calculateFieldLevelStats()` - Tính toán field level statistics
- `calculateCharacterLevelStats()` - Tính toán character level statistics
- `parseDateToUTC()` - Parse date string thành UTC
- `convertUTCToGMT7DateString()` - Convert UTC date thành GMT+7 string
- `getCommentFromReasonInput()` - Extract comment từ reason input
- `mergeResultsBySameThreshold()` - Merge results có cùng threshold

### 2. `mistakeManagement.js` (346 dòng)
**Chức năng:** Quản lý mistakes (QC operations)

**Functions:**
- `getMistakeReport()` - Lấy danh sách mistake reports
- `updateErrorType()` - Cập nhật error type cho mistake
- `getMistakeForPM()` - Lấy mistakes cho PM review
- `logActivity()` - Ghi log activity

### 3. `mistakeApproval.js` (620 dòng)
**Chức năng:** PM approve/reject và batch operations

**Functions:**
- `approveMistake()` - Approve một mistake cụ thể
- `rejectMistake()` - Reject một mistake cụ thể
- `batchUpdateErrorType()` - Batch update error types
- `batchApproveRejectMistakes()` - Batch approve/reject mistakes

### 4. `qualityStats.js` (938 dòng)
**Chức năng:** Thống kê chất lượng

**Functions:**
- `processGroupByReportLevel()` - Xử lý group data theo report level
- `getProjectQualityStats()` - Lấy thống kê chất lượng project
- `getVersionAwareQualityStats()` - Thống kê với version-aware logic
- `getLegacyQualityStats()` - Thống kê với legacy logic
- `getAllProjectsQualityStats()` - Thống kê tất cả projects

### 5. `fieldConfiguration.js` (321 dòng)
**Chức năng:** Quản lý field configuration

**Functions:**
- `getFieldConfiguration()` - Lấy field configuration
- `updateFieldConfiguration()` - Cập nhật field configuration
- `deleteFieldConfiguration()` - Xóa field configuration (version control)

### 6. `projectThreshold.js` (409 dòng)
**Chức năng:** Quản lý project threshold

**Functions:**
- `getProjectThreshold()` - Lấy project threshold configuration
- `createOrUpdateProjectThreshold()` - Tạo/cập nhật threshold (version control)
- `deleteThresholdItem()` - Xóa một threshold item cụ thể
- `deleteProjectThreshold()` - Xóa project threshold (version control)

### 7. `index.js` (27 dòng)
**Chức năng:** Export tất cả functions từ các modules

**Exports:** Tất cả functions từ 6 modules trên bằng spread operator

## Migration Process

### 1. Cập nhật Import
Thay đổi import trong `reportingController.js`:
```javascript
// Before
const { ... } = require('../services/reportingService');

// After  
const { ... } = require('../services/reporting');
```

### 2. Backup
File gốc `reportingService.js` vẫn được giữ nguyên để backup và đối chiếu.

### 3. Testing
Sau khi migration, cần test các endpoints để đảm bảo:
- Tất cả functions vẫn hoạt động bình thường
- Import/export đúng giữa các modules
- Không có regression bugs

## Lợi ích

1. **Maintainability:** Dễ bảo trì hơn với code được tách thành modules nhỏ
2. **Readability:** Dễ đọc và hiểu logic từng chức năng cụ thể
3. **Scalability:** Dễ mở rộng và thêm features mới cho từng module
4. **Testing:** Dễ unit test từng module riêng biệt
5. **Collaboration:** Team có thể làm việc song song trên các modules khác nhau

## Lưu ý

- Các helper functions được share giữa modules thông qua `reportingHelpers.js`
- Version control logic được giữ nguyên cho field config và project threshold
- Cache mechanism vẫn hoạt động bình thường
- Database connections và models vẫn sử dụng pattern cũ

## Cấu trúc Dependencies

```
index.js
├── reportingHelpers.js (standalone)
├── mistakeManagement.js (uses helpers)
├── mistakeApproval.js (uses helpers)
├── qualityStats.js (uses helpers)
├── fieldConfiguration.js (standalone)
└── projectThreshold.js (standalone)
``` 