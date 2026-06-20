# Hướng dẫn Monitor hệ thống

> Stack quan sát: **Loki** (logs) + **Tempo** (traces) + **Prometheus/Grafana** (metrics) + **Sentry** (errors), nối nhau bằng **một `traceId`** (OpenTelemetry).
> Chi tiết kiến trúc: [logging.md](./logging.md).

---

## 1. Cổng truy cập

| Công cụ | Địa chỉ | Đăng nhập |
| --- | --- | --- |
| Grafana (logs + traces + metrics) | `http://<vps-ip>:3000` | `admin` / mật khẩu trong `packages/infra/.env` (`GRAFANA_PASSWORD`) |
| Sentry (errors) | org `that-nails-tech` | tài khoản Sentry; project `node-express` (BE), `javascript-react` (FE) |
| Health check BE | `/health` (liveness), `/health/ready` (DB+Redis+Minio) | - |

`traceId` = OpenTelemetry trace id, xuất hiện ở: header `X-Request-ID` (FE nhận), log line (Loki), span (Tempo), tag trên Sentry. Đây là sợi chỉ xuyên suốt cả 4 công cụ.

---

## 2. Dùng cái nào nhiều nhất, để làm gì

Xếp theo tần suất dùng thực tế:

1. **Sentry — dùng nhiều nhất.** Tự động báo khi có lỗi (không cần ai canh). Trả lời "**cái gì** lỗi, **ở dòng code nào**" — stack trace đã map về `.ts` nhờ source map, kèm nguyên nhân gốc (`cause`) và `traceId`. Đây là điểm vào của hầu hết các vụ điều tra.
2. **Grafana -> Loki (logs).** Trả lời "**chuyện gì đã xảy ra quanh request này**". Lọc theo `traceId` để xem toàn bộ log của 1 request (BE + nginx). Dùng khi Sentry chưa đủ ngữ cảnh, hoặc khi lỗi không phải exception (vd 4xx, hành vi lạ).
3. **Grafana -> Prometheus (metrics).** Trả lời "**hệ thống có khỏe không, xu hướng ra sao**". Nhìn hằng ngày: throughput, tỉ lệ lỗi, độ trễ p95, CPU/RAM container. Đây là nơi phát hiện sự cố *trước* khi user báo.
4. **Grafana -> Tempo (traces).** Trả lời "**request chậm/lỗi ở bước nào**". Mở 1 trace -> waterfall các span (middleware, `pg.query`, gọi mạng ngoài). Dùng khi cần biết nút thắt (DB chậm? gọi API ngoài treo?).

Quy tắc nhớ nhanh:
- **Lỗi** -> Sentry. **Log 1 request** -> Loki. **Chậm** -> Tempo. **Sức khỏe/xu hướng** -> Prometheus.

---

## 3. Monitor thường ngày (proactive)

Mục tiêu: phát hiện sớm, trước khi user báo.

**Mỗi ngày (5 phút):**
- **Sentry**: lướt issue mới / regression. Ưu tiên issue mới xuất hiện sau lần deploy gần nhất (xem tag `release` = git sha). Bật **Alerts** để Sentry chủ động báo (new issue, hoặc affected users > N) qua Slack/Telegram.
- **Grafana**: nhìn 4 chỉ số chính (panel RED + tài nguyên):
  - Error rate có nhảy không?
  - p95 latency có tăng bất thường không?
  - CPU/RAM container có gần ngưỡng không?
  - Có container nào restart (healthcheck đỏ) không?

**Sau mỗi lần deploy:**
- Theo dõi Sentry **Release Health**: so error rate giữa release cũ và mới (vd `80ff315` -> `92d6423`). Release mới mà error rate vọt -> nghi ngờ ngay bản vừa deploy.
- Kiểm tra `/health/ready` trả `200` (DB/Redis/Minio đều thông).

**Định kỳ (tuần):**
- Xem `pg.query` chậm trong Tempo (`{ name =~ "pg.query.*" && duration > 100ms }`) để bắt query cần tối ưu/đánh index.
- Rà log mức `warn` trong Loki tìm vấn đề âm ỉ.

---

## 4. Xử lý khi có người báo lỗi kèm traceId

Đây là luồng debug chuẩn. Giả sử user đưa `traceId = abc123...` (lấy từ thông báo lỗi / header `X-Request-ID` / màn hình).

**Bước 1 — Sentry (cái gì lỗi).**
- Tìm: `https://that-nails-tech.sentry.io/issues/?query=trace:abc123...` (hoặc search theo message).
- Đọc: message + stack trace (đã map về `.ts`, có số dòng + snippet) + phần `cause` (nguyên nhân gốc, vd lỗi thư viện).
- Xem tag `release` để biết lỗi thuộc bản deploy nào, `environment` (dev/prod).

**Bước 2 — Loki (chuyện gì xảy ra quanh request).**
- Grafana -> Explore -> Loki:
  ```
  {service="backend"} | json | traceId="abc123..."
  ```
- Xem chuỗi log của request: method/path, status, log nghiệp vụ, dòng `level=50 "trpc internal error"` (có `cause`).
- Nếu nghi ở edge: `{service="nginx"} | json | traceId="abc123..."`.

**Bước 3 — Tempo (chậm/lỗi ở bước nào).**
- Trong panel Loki, bấm field `traceId` -> "Tempo" (derived field đã cấu hình) để nhảy thẳng sang trace.
- Hoặc Explore -> Tempo -> TraceQL: dán `abc123...`.
- Đọc waterfall: span nào tốn thời gian (DB? gọi mạng ngoài?), span nào `status = error`.

**Bước 4 — Kết luận & sửa.**
- Đối chiếu 3 nguồn: Sentry (dòng code) + Loki (ngữ cảnh) + Tempo (timing) -> tìm root cause.
- Sửa code; nếu là lỗi đã biết, commit kèm `Fixes NODE-EXPRESS-<n>` để Sentry auto-close khi merge.

> Ví dụ thật đã chạy: lỗi gửi OTP register. Sentry chỉ `auth.service.ts:244` (throw `EMAIL_SEND_FAILED`) + cause `Mail command failed: 530`; Loki có log cùng `traceId`; Tempo cho thấy span `tcp.connect` ra `:2525` (SMTP) chiếm ~3.4s = nút thắt. Root cause: chưa cấu hình `MAIL_USER/MAIL_PASS`.

---

## 5. Cheatsheet query

**Loki (LogQL)** — pino level số: `trace=10 debug=20 info=30 warn=40 error=50 fatal=60`.
```
{service="backend"} | json | level >= 50            # mọi error/fatal
{service="backend"} | json | traceId="<id>"         # toàn bộ log 1 request
{service="backend"} | json | msg="trpc internal error"
{service="nginx"}   | json | status >= 500          # 5xx ở edge
{service="backend"} | json | level >= 50 | line_format "{{.msg}}"   # gọn
```

**Tempo (TraceQL):**
```
<traceId>                                       # mở 1 trace
{ status = error }                              # trace lỗi
{ duration > 1s }                               # request chậm
{ name =~ "pg.query.*" && duration > 100ms }    # query DB chậm
{ resource.service.name = "backend" }
```

**Prometheus (PromQL)** — metric từ prom-client: `http_request_duration_seconds`.
```
sum(rate(http_request_duration_seconds_count[5m]))                                   # Rate (throughput)
sum(rate(http_request_duration_seconds_count{status=~"5.."}[5m]))                    # Errors
histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))  # Duration p95
sum(rate(http_request_duration_seconds_count[5m])) by (route)                        # theo endpoint
rate(container_cpu_usage_seconds_total{name=~"trelloclone3.*"}[5m])                  # CPU container (cAdvisor)
container_memory_usage_bytes{name=~"trelloclone3.*"}                                 # RAM container
```

---

## 6. RED & USE — khung chỉ số chuẩn

- **RED** (cho service hướng-request: API/web): **R**ate (req/s), **E**rrors (req lỗi/s), **D**uration (p50/p95/p99). Trả lời "**người dùng có bị ảnh hưởng không**". Map vào metric `http_request_duration_seconds` (xem cheatsheet trên).
- **USE** (cho tài nguyên: CPU/RAM/disk/net): **U**tilization, **S**aturation, **E**rrors. Trả lời "**vì sao** (hết CPU/RAM...)". Dùng metric từ node-exporter (host) + cAdvisor (container).

Hai cái bổ sung nhau: RED báo có vấn đề, USE giải thích nguyên nhân tài nguyên. "Dashboard RED" = 1 dashboard Grafana gồm 3 panel Rate/Errors/Duration (thường tách thêm theo `route`).

---

## 7. Chưa có, nên dựng tiếp

Hiện mới có datasource (Loki/Tempo/Prometheus) tự provision; **chưa có dashboard và alert**.

1. **Dashboards**: import Node Exporter Full (id `1860`), cAdvisor, Loki; + 1 dashboard RED tự build. Nên provision file JSON vào `packages/infra/grafana/` để versioned.
2. **Alert rules (Grafana)**: error rate (burn-rate), p95 tăng >30%, slow query >2s, `/health` non-200 >1 phút -> route Slack/Telegram.
3. **Sentry Alerts**: new issue / affected users > N.
4. **Uptime**: ping `/health` định kỳ (Grafana hoặc monitor ngoài).

---

## 8. Lưu ý vận hành

- **Retention**: dev giữ ngắn (logs/traces ~7d), prod dài hơn (~30d). Chunk lưu trong Minio.
- **Sampling traces**: dev `1.0` (lấy hết), prod `~0.1` (10%) để tiết kiệm — set trong `tracing.ts`.
- **Source map**: upload lên Sentry lúc build, KHÔNG serve cho client (đã xoá `.map` khỏi bundle). `release` = git sha phải set khi deploy (`export SENTRY_RELEASE=$(git rev-parse --short HEAD)`) để khớp map.
- **PII**: log đã redact `cookie`/`authorization`/`password`/`token` (Pino redact + Vector remap). Đừng log thêm secret.
- **`/metrics`** chỉ nội bộ (Prometheus scrape qua Docker network), nginx không expose ra ngoài.
