# Documentation: Reporting Service & API (Mistake QC/PM Flow)

## 1. Tổng quan luồng nghiệp vụ

### 1.1. Các trạng thái lỗi (mistake_details.status)
- `WAIT_QC`: Chờ QC gán error_type (lần đầu hoặc sau khi bị reject)
- `WAIT_PM`: Chờ PM duyệt lỗi
- `REJECTED_BY_PM`: PM reject, chờ QC xử lý lại
- `APPROVED_BY_PM`: PM đã approve, chờ chuyển sang DONE
- `DONE`: Đã hoàn thành, không chỉnh sửa nữa

### 1.2. Vòng đời lỗi
1. QC gán error_type → `WAIT_PM`
2. PM approve → `APPROVED_BY_PM` → copy sang mistake_approval → `DONE`
3. PM reject → `REJECTED_BY_PM` (ghi lý do)
4. QC sửa lại/gửi lại → `WAIT_PM` (ghi lý do nếu có)
5. Lặp lại 2-3 cho đến khi DONE

### 1.3. Lịch sử lý do (reason)
- Mỗi lần reject/approve đều push entry mới vào mảng `reason` (history)
- Lưu action, user, nội dung, thời gian

### 1.4. Logging
- Mọi thao tác đều ghi vào collection `activity_log` (TTL 45 ngày)

---

## 2. API & Service Logic

### 2.1. Lấy lỗi cho UI QC
- **API:** `GET /api/v1/reporting/mistake-report`
- **Filter:** status `WAIT_QC` hoặc `REJECTED_BY_PM`
- **Service:** `getMistakeReport`
- **Query params:**
project_id: 5f50c19580ec50001c246edf
date_from: 2023-08-21
date_to: 2025-05-28

### 2.2. QC gán error_type
- **API:** `PATCH /api/v1/reporting/mistake-report/error-type`
- **Service:** `updateErrorType`
- **Logic:**
  - Update error_type, chuyển status sang `WAIT_PM`
  - Ghi activity_log
- **body request:**
{
  "project_id": "5f50c19580ec50001c246edf",
  "doc_id": "6819d16a45d331001bc172b0",
  "error_id": "683a77d79e116fe39b60d32b",
  "error_type": "Error Typing"
}

### 2.3. Lấy lỗi cho UI PM
- **API:** `GET /api/v1/reporting/mistake-report/pm`
- **Filter:** status `WAIT_PM`
- **Service:** `getMistakeForPM`
- **Query params:**
project_id: 5f50c19580ec50001c246edf
date_from: 2023-08-21
date_to: 2025-05-28

### 2.4. PM approve lỗi
- **API:** `PATCH /api/v1/reporting/mistake-report/approve`
- **Service:** `approveMistake`
- **Logic:**
  - Transaction: update status, push reason, copy sang `mistake_approval`, log
  - Nếu lỗi, rollback toàn bộ
- **Body request:**
{
  "project_id": "5f50c19580ec50001c246edf",
  "doc_id": "6819d16a45d331001bc172b0",
  "error_id": "683a77d79e116fe39b60d32b",
  "reason": "OK rồi nhé"
}

### 2.5. PM reject lỗi
- **API:** `PATCH /api/v1/reporting/mistake-report/reject`
- **Service:** `rejectMistake`
- **Logic:**
  - Update status, push reason, log
- **Body request:**
{
  "project_id": "5f50c19580ec50001c246edf",
  "doc_id": "6819d16a45d331001bc172b0",
  "error_id": "683a77d79e116fe39b60d32b",
  "reason": "reject từ PM thử lại hàm mới reject transaction"
}

---

## 3. Mapping status → UI
- **UI QC:** Lấy lỗi status `WAIT_QC`, `REJECTED_BY_PM`
- **UI PM:** Lấy lỗi status `WAIT_PM`

---

## 4. Schema liên quan
- `mistake_report`: lưu toàn bộ lỗi, trạng thái, history, metadata
- `mistake_approval`: lưu lỗi đã được PM duyệt (bản ghi nhỏ, chỉ metadata cần thiết)
- `activity_log`: log thao tác, TTL 45 ngày

---

## 5. Transaction & đồng bộ
- Khi approve, mọi thao tác (update status, copy, log) đều nằm trong 1 transaction
- Nếu lỗi, rollback toàn bộ

---

## 6. Lưu ý
- Mọi thay đổi trạng thái đều phải log và lưu history
- Khi lấy dữ liệu cho UI, luôn filter đúng status
- Khi cron job update lại document, không reset status/error_type đã được duyệt

---

**File này tự động sinh bởi AI Tech Lead khi refactor/triển khai nghiệp vụ reporting mistake QC/PM.**
